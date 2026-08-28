// Where the drivers are.
//
// ── What this can and cannot do ──────────────────────────────────────────────
// A web app cannot track a phone in the background. `watchPosition` runs while
// the page is alive and visible; iOS Safari suspends JavaScript the moment the
// screen locks or the driver switches apps, and a PWA on the home screen behaves
// exactly the same. There is no web API that changes this — Background Sync and
// Periodic Background Sync do not carry location, and neither exists on iOS.
//
// So this gives the office:
//   · a live position while the driver has the app open (which is every time
//     they touch a stop), and
//   · a breadcrumb trail of everywhere it managed to sample.
//
// It does NOT give a moving dot while the driver is in Google Maps between
// stops, because at that moment our page is not running. Always-on tracking
// needs a native app or a device in the van; see the note in CLAUDE.md.
//
// ── The rule that keeps it honest ────────────────────────────────────────────
// Every ping carries the timestamp the DEVICE recorded, never the moment the
// server received it. A phone that comes back into signal after twenty minutes
// posts twenty minutes of history, and if those were stamped on arrival the
// office would be told a driver is somewhere they left long ago. Position is the
// one thing where stale and wrong are the same thing, so `livePositions` reports
// age on every row and the UI greys anything old rather than drawing it as now.
import { hasDb, query } from './db';

let _schema = null;
export function ensureLocationSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS driver_pings (
        id bigserial PRIMARY KEY,
        user_id  int NOT NULL,
        job_id   int,
        lat      numeric(9,6) NOT NULL,
        lng      numeric(9,6) NOT NULL,
        accuracy_m int,
        speed_kmh  numeric(6,2),
        heading    int,
        source   text NOT NULL DEFAULT 'watch',
        at       timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_driver_pings_user_at ON driver_pings(user_id, at DESC);
      CREATE INDEX IF NOT EXISTS idx_driver_pings_at ON driver_pings(at);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// Anything older than this is history, not a location. Five minutes is about
// two red lights and a delivery — long enough not to flicker on a lost signal,
// short enough that nobody is sent to where somebody used to be.
export const FRESH_MINUTES = 5;
const MAX_BATCH = 120;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Take a batch from a phone. Deliberately forgiving about what it accepts and
// strict about what it stores: a driver in a basement replaying an hour of
// queued pings must not be able to write a row that reads as "now".
export async function recordPings(userId, pings = [], { jobId } = {}) {
  if (!hasDb() || !userId) return { stored: 0 };
  await ensureLocationSchema();
  const now = Date.now();
  const rows = [];
  for (const p of (Array.isArray(pings) ? pings : []).slice(0, MAX_BATCH)) {
    const lat = num(p?.lat);
    const lng = num(p?.lng);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    // A phone with a wrong clock would otherwise poison the freshness test in
    // both directions, so the future is clamped to now and ancient is dropped.
    const t = Number(p?.at);
    const at = Number.isFinite(t) && t > 0 ? Math.min(t, now) : now;
    if (now - at > 24 * 3600 * 1000) continue;
    const acc = num(p?.accuracy);
    rows.push({
      lat, lng, at: new Date(at),
      accuracy: acc === null ? null : Math.round(Math.min(Math.max(acc, 0), 100000)),
      // Browsers report m/s; the office reads km/h.
      speed: num(p?.speed) === null || num(p.speed) < 0 ? null : Math.round(num(p.speed) * 3.6 * 10) / 10,
      heading: num(p?.heading) === null ? null : Math.round(num(p.heading)) % 360,
      jobId: num(p?.jobId) || num(jobId) || null,
      source: p?.source === 'event' ? 'event' : 'watch'
    });
  }
  if (!rows.length) return { stored: 0 };

  // One statement, not one per ping: a van coming back into signal posts a
  // hundred of these at once.
  const vals = [];
  const params = [];
  rows.forEach((r, i) => {
    const b = i * 9;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
    params.push(Number(userId), r.jobId, r.lat, r.lng, r.accuracy, r.speed, r.heading, r.source, r.at);
  });
  await query(
    `INSERT INTO driver_pings (user_id, job_id, lat, lng, accuracy_m, speed_kmh, heading, source, at)
     VALUES ${vals.join(',')}`,
    params
  );
  return { stored: rows.length };
}

// Where everybody is, newest ping per driver. Every row says how old it is and
// the caller decides what to draw — this never pretends an old fix is current.
export async function livePositions() {
  if (!hasDb()) return { drivers: [], freshMinutes: FRESH_MINUTES };
  await ensureLocationSchema();
  const { rows } = await query(
    `SELECT u.id, COALESCE(NULLIF(u.name,''), u.email) AS name, u.phone,
            p.lat, p.lng, p.accuracy_m, p.speed_kmh, p.heading, p.at, p.job_id,
            EXTRACT(EPOCH FROM (now() - p.at)) AS age_s,
            j.job_number, j.customer_name, j.address, j.city, j.status AS job_status
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM driver_pings dp WHERE dp.user_id = u.id ORDER BY dp.at DESC LIMIT 1
       ) p ON true
       LEFT JOIN jobs j ON j.id = p.job_id
      WHERE u.is_driver = true
      ORDER BY p.at DESC NULLS LAST, name`
  );
  return {
    freshMinutes: FRESH_MINUTES,
    drivers: rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phone || null,
      lat: r.lat == null ? null : Number(r.lat),
      lng: r.lng == null ? null : Number(r.lng),
      accuracy: r.accuracy_m == null ? null : Number(r.accuracy_m),
      speed: r.speed_kmh == null ? null : Number(r.speed_kmh),
      heading: r.heading == null ? null : Number(r.heading),
      at: r.at ? r.at.toISOString() : null,
      ageSeconds: r.age_s == null ? null : Math.round(Number(r.age_s)),
      fresh: r.age_s != null && Number(r.age_s) <= FRESH_MINUTES * 60,
      onJob: r.job_number
        ? {
          id: r.job_id, jobNumber: r.job_number, status: r.job_status,
          customerName: r.customer_name,
          where: [r.address, r.city].filter(Boolean).join(', ') || null
        }
        : null
    }))
  };
}

// One driver's breadcrumbs for a day — where the van actually went, as far as
// the app was awake to see it.
export async function driverTrail(userId, { date } = {}) {
  if (!hasDb() || !userId) return [];
  await ensureLocationSchema();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : null;
  const { rows } = await query(
    `SELECT lat, lng, at, speed_kmh, job_id
       FROM driver_pings
      WHERE user_id = $1
        AND ($2::date IS NULL
             OR at >= ($2::date) AT TIME ZONE 'America/Toronto'
            AND at <  ($2::date + 1) AT TIME ZONE 'America/Toronto')
      ORDER BY at
      LIMIT 5000`,
    [Number(userId), day]
  );
  return rows.map((r) => ({
    lat: Number(r.lat), lng: Number(r.lng),
    at: r.at.toISOString(),
    speed: r.speed_kmh == null ? null : Number(r.speed_kmh),
    jobId: r.job_id || null
  }));
}

// Breadcrumbs are cheap to write and pointless to keep: six drivers sampling
// every 45 seconds is a hundred thousand rows a month, and nobody asks where a
// van was in April. Called from the write path, rarely.
export async function prunePings(days = 30) {
  if (!hasDb()) return { deleted: 0 };
  const { rowCount } = await query(
    `DELETE FROM driver_pings WHERE at < now() - make_interval(days => $1)`, [Number(days) || 30]
  ).catch(() => ({ rowCount: 0 }));
  return { deleted: rowCount || 0 };
}
