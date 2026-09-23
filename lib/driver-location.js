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
      -- A ping can now come from a TRUCK instead of a phone. Same table because
      -- it is the same thing — a position with the device's own timestamp on it,
      -- aged on every read — but the subject is a vehicle, never a person. The
      -- shortcut here would have been a fake driver account called "Box truck";
      -- it would also have put a phantom person in the roster, the Pay tab, both
      -- board columns, mergeDrivers and crewLost's missing-name banner.
      ALTER TABLE driver_pings ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE driver_pings ADD COLUMN IF NOT EXISTS vehicle_id  int;
      ALTER TABLE driver_pings ADD COLUMN IF NOT EXISTS battery_pct int;
      CREATE INDEX IF NOT EXISTS idx_driver_pings_vehicle_at
        ON driver_pings(vehicle_id, at DESC) WHERE vehicle_id IS NOT NULL;
      -- THE DEDUPE, and it is load-bearing. We poll PAJ far more often than the
      -- device reports, so one position would otherwise land three or four times
      -- and the trail would grow a pile at every red light. It also makes the
      -- backfill free to re-read an overlapping window, which is what lets it
      -- ask for everything since the last ping without keeping a cursor.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_pings_vehicle_dedupe
        ON driver_pings(vehicle_id, at) WHERE vehicle_id IS NOT NULL;
    `)
      .then(() => enforceSubjectRule())
      .catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// A ping belongs to a driver or to a van, and it is no use at all belonging to
// neither. Its own best-effort step rather than another statement in the schema
// string — the same reason enforceCrewRule() is: this is a net under a rule the
// two write paths already keep, and a net that fails to hang must not take the
// Live tab and the driver app down with it.
async function enforceSubjectRule() {
  try {
    await query(`
      DO $subject$ BEGIN
        ALTER TABLE driver_pings ADD CONSTRAINT driver_pings_subject
          CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN NULL; END $subject$;
    `);
  } catch (e) {
    console.error('driver_pings_subject not applied', e.message);
  }
}

// Anything older than this is history, not a location. Five minutes is about
// two red lights and a delivery — long enough not to flicker on a lost signal,
// short enough that nobody is sent to where somebody used to be.
export const FRESH_MINUTES = 5;

// A TRUCK's window is wider, and it is not a weaker standard — it is the same
// standard applied to a different device. A phone samples every 45 seconds while
// the app is open, so five minutes of silence from one means something. A
// tracker reports every few minutes by design and sleeps when the van is parked,
// so five minutes would grey out a device that is working perfectly and teach
// the office to ignore the colour. Fifteen means what five means for a phone:
// this has stopped saying anything and should not be trusted as "now".
export const VAN_FRESH_MINUTES = 15;

// How far back the backfill may reach, and therefore the oldest fix this will
// store. PAJ keeps the history whether or not we were watching, so after an
// outage there is a real gap to fill — but reaching back indefinitely would let
// one bad run rewrite a month of trail nobody is asking about.
export const MAX_BACKFILL_DAYS = 7;

const MAX_BATCH = 120;
// Bind parameters, not rows, are the real ceiling (Postgres stops at 65535 and
// each ping spends seven), so a backfill goes in slices rather than one statement.
const INSERT_CHUNK = 500;

// EMPTY IS NOT ZERO. `Number(null)` and `Number('')` are both 0, so a ping that
// carries no position — a phone whose fix failed, a tracker row with the field
// absent — would pass the lat/lng guard below as 0,0 and be stored as a real
// coordinate off the coast of Africa. Both write paths depend on this returning
// null so the row is dropped instead.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

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

// Take a batch from a TRACKER. Same rules as a phone's — the device's own
// timestamp, nothing from the future, nothing ancient — with two differences:
// the subject is a van, and the write is idempotent. We ask PAJ for the last
// position far more often than the device produces one, so the same fix arrives
// again and again; ON CONFLICT is what makes that free, and what lets the
// backfill re-read an overlapping window without keeping a cursor anywhere.
export async function recordVehiclePings(vehicleId, pings = []) {
  if (!hasDb() || !vehicleId) return { stored: 0 };
  await ensureLocationSchema();
  const now = Date.now();
  const rows = [];
  // NOT capped at MAX_BATCH. That cap is a phone's — a handset replaying a queue
  // is bounded and a batch beyond it is a bug. A backfill is legitimately
  // thousands of points, and truncating one would leave a hole in the trail that
  // nothing afterwards would ever go back and fill.
  for (const p of (Array.isArray(pings) ? pings : [])) {
    const lat = num(p?.lat);
    const lng = num(p?.lng);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const t = Number(p?.at);
    if (!Number.isFinite(t) || t <= 0) continue;
    // A tracker's clock can run ahead as easily as a phone's, and a fix stamped
    // in the future would read as permanently fresh — a dot that never greys
    // out is exactly the dot somebody rings a customer on.
    const at = Math.min(t, now);
    // The backfill reaches further than a phone ever does, so the window is the
    // same one the backfill is allowed to ask for rather than 24 hours.
    if (now - at > MAX_BACKFILL_DAYS * 86400e3) continue;
    const speed = num(p?.speedKmh);
    const heading = num(p?.heading);
    const battery = num(p?.batteryPct);
    rows.push({
      lat, lng, at: new Date(at),
      // PAJ reports km/h; the browser's m/s conversion above does not apply here.
      speed: speed === null || speed < 0 ? null : Math.round(speed * 10) / 10,
      heading: heading === null ? null : ((Math.round(heading) % 360) + 360) % 360,
      battery: battery === null ? null : Math.round(Math.min(Math.max(battery, 0), 100))
    });
  }
  if (!rows.length) return { stored: 0 };

  // Two rows carrying the same instant inside ONE statement are the conflict the
  // index cannot arbitrate — it settles a row against what is already committed,
  // not against its own command. Cheap to rule out here, and the alternative is
  // an error thrown mid-backfill over something nobody would think to look for.
  const byInstant = new Map();
  for (const r of rows) byInstant.set(r.at.getTime(), r);
  const unique = [...byInstant.values()].sort((a, b) => a.at - b.at);

  // Chunked, because a backfill after an outage is thousands of points and a
  // single statement would run out of bind parameters long before it ran out of
  // trail. Each chunk stands alone — a failure part-way leaves what landed.
  let stored = 0;
  for (let i = 0; i < unique.length; i += INSERT_CHUNK) {
    const chunk = unique.slice(i, i + INSERT_CHUNK);
    const tuples = chunk.map((_, n) => {
      const b = n * 7;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    const { rowCount } = await query(
      `INSERT INTO driver_pings (vehicle_id, lat, lng, speed_kmh, heading, battery_pct, at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (vehicle_id, at) WHERE vehicle_id IS NOT NULL DO NOTHING`,
      chunk.flatMap((r) => [Number(vehicleId), r.lat, r.lng, r.speed, r.heading, r.battery, r.at])
    );
    stored += rowCount || 0;
  }
  // `seen` is what the device reported, `stored` what was new. They differ on
  // every ordinary poll, which is the dedupe working — a watcher that reported
  // only `stored` would read as broken every time a van sat still.
  return { stored, seen: unique.length };
}

// One van's breadcrumbs for a day. Twin of driverTrail, and separate from it
// because the two answer different questions: this is where the TRUCK went,
// that is where the person was. They disagree the moment a driver walks a
// fridge up a driveway, and both answers are correct.
export async function vehicleTrail(vehicleId, { date } = {}) {
  if (!hasDb() || !vehicleId) return [];
  await ensureLocationSchema();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : null;
  // The `::timestamp` before AT TIME ZONE is load-bearing. A bare date takes the
  // timestamptz overload, so Postgres reads midnight in the SESSION zone — UTC on
  // Vercel — and the whole day slides four hours: asking for the 23rd returns 8pm
  // on the 22nd through 8pm on the 23rd. Casting first picks the overload that
  // means what we want. (driverTrail below carries the same bug unfixed; the
  // orders-board branch corrects it there, so leave it alone here.)
  const { rows } = await query(
    `SELECT lat, lng, at, speed_kmh
       FROM driver_pings
      WHERE vehicle_id = $1
        AND ($2::date IS NULL
             OR at >= ($2::date)::timestamp AT TIME ZONE 'America/Toronto'
            AND at <  ($2::date + 1)::timestamp AT TIME ZONE 'America/Toronto')
      ORDER BY at
      LIMIT 5000`,
    [Number(vehicleId), day]
  );
  return rows.map((r) => ({
    lat: Number(r.lat), lng: Number(r.lng),
    at: r.at.toISOString(),
    speed: r.speed_kmh == null ? null : Number(r.speed_kmh)
  }));
}

// Newest ping per tracked van. Deliberately a SEPARATE list from the drivers,
// never merged into them: the phone says where the person is and the tracker
// says where the truck is, and folding one into the other would overwrite a
// real fix with a different real fix and leave nobody able to tell which they
// were looking at.
export async function vehiclePositions() {
  if (!hasDb()) return [];
  await ensureLocationSchema();
  const { rows } = await query(
    `SELECT v.id, v.name, v.plate,
            p.lat, p.lng, p.speed_kmh, p.heading, p.battery_pct, p.at,
            EXTRACT(EPOCH FROM (now() - p.at)) AS age_s,
            c.crew
       FROM vehicles v
       LEFT JOIN LATERAL (
         SELECT * FROM driver_pings dp
          WHERE dp.vehicle_id = v.id ORDER BY dp.at DESC LIMIT 1
       ) p ON true
       -- Who is out in it, read LIVE off the open shift rather than stamped on
       -- the ping. A van that changed hands at lunchtime has to read as whoever
       -- has it now, and only a driver (not a passenger) is responsible for one.
       LEFT JOIN LATERAL (
         SELECT string_agg(COALESCE(NULLIF(u.name,''), u.email), ', ') AS crew
           FROM driver_shifts s JOIN users u ON u.id = s.user_id
          WHERE s.vehicle_id = v.id AND s.ended_at IS NULL AND s.driving = true
       ) c ON true
      WHERE v.active = true AND v.tracker_device_id IS NOT NULL
      ORDER BY p.at DESC NULLS LAST, v.name`
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    plate: r.plate || null,
    crew: r.crew || null,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    speed: r.speed_kmh == null ? null : Number(r.speed_kmh),
    heading: r.heading == null ? null : Number(r.heading),
    battery: r.battery_pct == null ? null : Number(r.battery_pct),
    at: r.at ? r.at.toISOString() : null,
    ageSeconds: r.age_s == null ? null : Math.round(Number(r.age_s)),
    fresh: r.age_s != null && Number(r.age_s) <= VAN_FRESH_MINUTES * 60
  }));
}

// Where everybody is, newest ping per driver. Every row says how old it is and
// the caller decides what to draw — this never pretends an old fix is current.
export async function livePositions() {
  if (!hasDb()) return { drivers: [], vehicles: [], freshMinutes: FRESH_MINUTES, vanFreshMinutes: VAN_FRESH_MINUTES };
  await ensureLocationSchema();
  // The vans are fetched alongside, not merged in. `drivers` keeps exactly the
  // shape it has always had so every existing reader is untouched.
  const vans = await vehiclePositions();
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
    vanFreshMinutes: VAN_FRESH_MINUTES,
    vehicles: vans,
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
