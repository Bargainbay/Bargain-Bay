// Keeping the trucks' positions coming in.
//
// This is the same shape as lib/cda-watch.js and lib/freightcom-watch.js, and
// for the same reason: it polls somebody else's system on a schedule, and the
// failure it has to defend against is not an error — it is SILENCE. A van that
// has been parked since Friday and a tracker that stopped reporting in March
// look identical on a map. CDA's watcher proved that exactly: it could not read
// the workbook for months because one environment variable was never set in
// Production, and it returned quietly to a cron nobody reads, every three hours.
//
// So everything here reports how it went, and every way it can give up sends
// one throttled email to the dispatch desk.
//
// Two jobs, deliberately different:
//   · pollTrackers   — the DOT. Last known position, on demand, while somebody
//                      is actually looking at the Live tab.
//   · backfillTrackers — the TRAIL. Everything PAJ recorded since our newest
//                      ping, on a schedule, whether or not anyone was watching.
import { hasDb, query } from './db';
import { getSetting, setSetting } from './settings';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';
import { pajConfigured, pajLastPositions, pajRange } from './paj-gps';
import { recordVehiclePings, MAX_BACKFILL_DAYS } from './driver-location';

// How often the Live tab is allowed to spend an API call. LiveMap refreshes
// every 20 seconds and the device reports every few minutes, so without this the
// board would ask PAJ three times for each new fix it produces.
const POLL_EVERY_SECONDS = 45;
const POLL_KEY = 'tracker_last_poll';
const ALERT_KEY = 'tracker_alert';
const STATUS_KEY = 'tracker_status';
const QUIET_HOURS = 12;

async function trackedVans() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, name, tracker_device_id FROM vehicles
      WHERE active = true AND tracker_device_id IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => ({ id: r.id, name: r.name, deviceId: String(r.tracker_device_id) }));
}

// Every way this gives up, in one place. Throttled on the MESSAGE, not the
// clock: a wrong password would otherwise mail the desk every fifteen minutes
// until somebody fixed it, and the second copy of that email is noise.
async function failed(reason, { quiet = false } = {}) {
  await setSetting(STATUS_KEY, { ok: false, reason, at: new Date().toISOString() }).catch(() => {});
  if (!quiet) {
    try {
      const now = Date.now();
      const last = await getSetting(ALERT_KEY, null);
      if (!last || last.reason !== reason || now - new Date(last.at).getTime() >= QUIET_HOURS * 3600e3) {
        await setSetting(ALERT_KEY, { reason, at: new Date(now).toISOString() });
        await sendEmail({
          to: dispatchDesk(),
          subject: '[Dispatch] The truck tracker is not reporting',
          brand: 'rs_solutions',
          html: `<p><b>The van tracker has stopped being read.</b></p>
            <p>${reason}</p>
            <p>Nothing is reaching the Live tab from it, so the van will sit there
            showing its last known position and nothing will say why. The commonest
            causes are the PAJ sign-in having changed and the device id on the van
            being wrong — both are under <b>People &amp; access</b> on dispatch.</p>
            <p style="color:#777;font-size:12px">You will not get this again for ${QUIET_HOURS} hours
            unless the problem changes.</p>`
        });
      }
    } catch (e) {
      console.error('tracker alert failed', e.message);
    }
  }
  return { ok: false, reason };
}

async function succeeded(detail) {
  await setSetting(STATUS_KEY, { ok: true, at: new Date().toISOString(), ...detail }).catch(() => {});
  return { ok: true, ...detail };
}

// What the Live tab's banner reads. Never throws and never blocks the board —
// a status nobody can fetch must not be the reason the map fails to draw.
export async function trackerStatus() {
  const vans = await trackedVans();
  const status = await getSetting(STATUS_KEY, null).catch(() => null);
  return {
    configured: pajConfigured(),
    tracked: vans.length,
    lastOk: status?.ok ? status.at || null : null,
    lastFail: status && !status.ok ? { reason: status.reason, at: status.at } : null
  };
}

// ── The dot ──────────────────────────────────────────────────────────────────
export async function pollTrackers({ force = false } = {}) {
  if (!hasDb()) return { ok: false, reason: 'No database.', skipped: true };
  // Not configured is not a failure. A deployment with no trackers must not mail
  // the dispatch desk about it twice a day forever.
  if (!pajConfigured()) return { ok: false, reason: 'PAJ_EMAIL / PAJ_PASSWORD are not set.', skipped: true };

  const vans = await trackedVans();
  if (!vans.length) return { ok: true, skipped: true, reason: 'No van has a tracker paired.' };

  // Throttled on when we last ASKED, not on the newest ping we hold: a device
  // reporting every five minutes would otherwise look "due" on every refresh in
  // between. A soft failure reading this degrades to polling more often, which
  // is the harmless direction.
  if (!force) {
    const last = await getSetting(POLL_KEY, null).catch(() => null);
    const since = last?.at ? Date.now() - new Date(last.at).getTime() : Infinity;
    if (since < POLL_EVERY_SECONDS * 1000) {
      return { ok: true, skipped: true, reason: 'Polled moments ago.' };
    }
  }
  await setSetting(POLL_KEY, { at: new Date().toISOString() }).catch(() => {});

  let points;
  try {
    points = await pajLastPositions(vans.map((v) => v.deviceId));
  } catch (e) {
    return failed(`PAJ could not be read: ${e?.message || e}`);
  }
  if (!points.length) {
    // A real answer carrying no usable rows is not the same as a broken call,
    // and it is the shape a wrong device id takes.
    return failed('PAJ answered but returned no position for any paired device — check the device id on the van.');
  }

  const byDevice = new Map(vans.map((v) => [v.deviceId, v]));
  let stored = 0;
  const unmatched = [];
  for (const p of points) {
    // ONE van, ONE device. A point that cannot be attributed is DROPPED, never
    // given to the only van we happen to be tracking: a dot on the wrong truck
    // is worse than no dot, because somebody routes off it.
    const van = byDevice.get(String(p.deviceId));
    if (!van) { unmatched.push(p.deviceId || '(no id)'); continue; }
    try {
      const r = await recordVehiclePings(van.id, [p]);
      stored += r.stored;
    } catch (e) {
      return failed(`Could not store ${van.name}'s position: ${e?.message || e}`);
    }
  }
  if (unmatched.length && !stored) {
    return failed(`PAJ returned positions for ${unmatched.join(', ')}, which no van is paired with.`);
  }
  return succeeded({ vans: vans.length, points: points.length, stored, unmatched });
}

// ── The trail ────────────────────────────────────────────────────────────────
// Reads everything PAJ recorded since our newest ping for each van. PAJ keeps
// the history whether or not anybody here was watching, so the hours nobody had
// the board open are filled in properly rather than being sampled into gaps.
// The dedupe index makes the overlap free, which is why there is no cursor to
// keep and nothing to get out of step.
export async function backfillTrackers() {
  if (!hasDb()) return { ok: false, reason: 'No database.', skipped: true };
  if (!pajConfigured()) return { ok: false, reason: 'PAJ_EMAIL / PAJ_PASSWORD are not set.', skipped: true };

  const vans = await trackedVans();
  if (!vans.length) return { ok: true, skipped: true, reason: 'No van has a tracker paired.' };

  const now = Date.now();
  const floor = now - MAX_BACKFILL_DAYS * 86400e3;
  const results = [];
  let trouble = null;
  for (const van of vans) {
    const { rows } = await query(
      `SELECT max(at) AS newest FROM driver_pings WHERE vehicle_id = $1`, [van.id]
    ).catch(() => ({ rows: [] }));
    const newest = rows?.[0]?.newest ? new Date(rows[0].newest).getTime() : 0;
    // Overlap by a minute so a fix landing exactly on the boundary is not the
    // one point that falls between two runs.
    const from = Math.max(floor, newest ? newest - 60e3 : now - 6 * 3600e3);
    try {
      const points = await pajRange(van.deviceId, from, now);
      const r = await recordVehiclePings(van.id, points);
      results.push({ van: van.name, seen: r.seen ?? points.length, stored: r.stored });
    } catch (e) {
      // One van failing is a log line, not a reason to skip the others — the
      // same rule the cron section already keeps for unrelated chores.
      trouble = `${van.name}: ${e?.message || e}`;
      results.push({ van: van.name, error: trouble });
    }
  }
  if (trouble && results.every((r) => r.error)) return failed(`The backfill could not read PAJ — ${trouble}`);
  return succeeded({ backfilled: results, partial: trouble || null });
}
