// The truck's own tracker.
//
// A Salind/PAJ device is a sealed unit with its own SIM, and it is LOCKED to
// PAJ's FINDER portal: the manual documents no SMS server command, so the usual
// cheap-tracker trick of pointing the box at a TCP listener of our own is not
// available. The device talks to PAJ and we talk to PAJ.
//
// This module is the whole of that conversation. It imports nothing from the
// app on purpose — the vendor's field names must not leak into the location
// logic, the same separation lib/xlsx-lite.js keeps. Everything above it deals
// in our own ping shape:
//
//   { deviceId, lat, lng, at (ms), speedKmh, heading, batteryPct }
//
// ── The field names are DEFENSIVE, and that is not laziness ──────────────────
// PAJ's responses were mapped from their published docs, not from a live
// account, and their tracker rows have carried more than one spelling over the
// years (`lat`/`latitude`, `dateunix`/`unixtimestamp`). Reading a position out
// of the wrong key gives null, and a null position is a van that silently
// stopped reporting — the exact failure the watcher exists to end. So every
// field is read through a list of candidates and anything unreadable is DROPPED
// with the row, never guessed at.
//
// Two things to confirm against the first real device, both marked below:
// whether `speed` arrives in km/h, and which key carries the device id.
const BASE = (process.env.PAJ_API_URL || 'https://connect.paj-gps.de/api/v1').replace(/\/$/, '');

// Every call to somebody else's API is capped. A hanging request to PAJ must
// not eat a cron invocation, and on the Live tab it must not hold a dispatcher's
// board hostage either — the position is worth less than the page.
const TIMEOUT_MS = 8000;

export function pajConfigured() {
  return !!(process.env.PAJ_EMAIL && process.env.PAJ_PASSWORD);
}

// `Number(null)` is 0, and so is `Number('')`. Left to the plain isFinite test a
// row carrying no position at all becomes lat 0, lng 0 — a real coordinate in
// the Gulf of Guinea, which would be drawn on the board as a fix rather than
// dropped as the absence it is. Empty is NOT zero here.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

// Read the first key that actually carries a value. `0` is a real latitude and
// a real speed, so this tests for null/undefined/'' rather than truthiness.
const pick = (row, keys) => {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

async function http(path, { method = 'GET', body, form, token } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (form) {
      payload = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${path}`, {
      method, headers, body: payload, signal: ctl.signal, cache: 'no-store'
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — handled below */ }
    if (!res.ok) {
      const err = new Error(
        json?.error?.message || json?.message || `PAJ answered ${res.status}`
      );
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`PAJ did not answer within ${TIMEOUT_MS / 1000}s`);
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── The token ────────────────────────────────────────────────────────────────
// Held in module memory, which in a serverless runtime means per instance: a
// cold start pays one extra login and that is the whole cost. Deliberately NOT
// persisted to `settings` — a bearer token in a database row is another secret
// at rest for no gain, when the credentials that mint it are already in env.
let _token = null; // { value, expiresAt }

async function login() {
  const json = await http('/login', {
    method: 'POST',
    form: { email: process.env.PAJ_EMAIL, password: process.env.PAJ_PASSWORD }
  });
  const value = pick(json?.success || json || {}, ['token', 'access_token', 'jwt']);
  if (!value) throw new Error('PAJ accepted the sign-in but returned no token.');
  // Their tokens are short-lived and the documented expiry has moved before.
  // Half an hour is well inside it, and a 401 re-login covers being wrong.
  _token = { value: String(value), expiresAt: Date.now() + 30 * 60 * 1000 };
  return _token.value;
}

async function authed(path, opts = {}) {
  if (!pajConfigured()) throw new Error('PAJ_EMAIL / PAJ_PASSWORD are not set.');
  let tok = _token && _token.expiresAt > Date.now() ? _token.value : await login();
  try {
    return await http(path, { ...opts, token: tok });
  } catch (e) {
    // Exactly one re-login and one retry. A loop here is a cron spending its
    // whole budget proving the password is wrong.
    if (e?.status !== 401) throw e;
    _token = null;
    tok = await login();
    return http(path, { ...opts, token: tok });
  }
}

// ── Their rows → ours ────────────────────────────────────────────────────────
function toPing(row, fallbackDeviceId = null) {
  const lat = num(pick(row, ['lat', 'latitude']));
  const lng = num(pick(row, ['lng', 'lon', 'longitude']));
  if (lat === null || lng === null) return null;

  // THE TIMESTAMP IS THE DEVICE'S, always. A tracker that was out of coverage
  // in an underground bay posts its backlog the moment it finds signal, and a
  // row stamped on arrival would tell the office a van is somewhere it left
  // twenty minutes ago. Position is the one thing where stale and wrong are the
  // same thing — recordVehiclePings depends on this being their clock.
  const secs = num(pick(row, ['dateunix', 'unixtimestamp', 'dateunixtime', 'timestamp']));
  const iso = pick(row, ['dateutc', 'date']);
  const at = secs !== null
    ? secs * 1000
    : (iso ? Date.parse(String(iso)) : NaN);
  if (!Number.isFinite(at) || at <= 0) return null;

  // UNVERIFIED against a live device: their portal displays km/h and the docs
  // give `speed` no unit. If the first real truck reads ~3.6x high it is m/s;
  // the clamp below stops a bad unit from painting a delivery van at 900 km/h
  // on the board, but it will not silently convert one.
  const speed = num(pick(row, ['speed', 'speed_kmh']));
  const heading = num(pick(row, ['direction', 'heading', 'course']));
  const battery = num(pick(row, ['battery', 'battery_level', 'batterie']));

  return {
    deviceId: String(pick(row, ['iddevice', 'deviceID', 'deviceId', 'device_id']) ?? fallbackDeviceId ?? ''),
    lat,
    lng,
    at,
    speedKmh: speed === null || speed < 0 || speed > 300 ? null : Math.round(speed * 10) / 10,
    heading: heading === null ? null : ((Math.round(heading) % 360) + 360) % 360,
    batteryPct: battery === null || battery < 0 || battery > 100 ? null : Math.round(battery)
  };
}

const shape = (json, fallbackDeviceId) => {
  const rows = Array.isArray(json?.success) ? json.success
    : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
  return rows.map((r) => toPing(r, fallbackDeviceId)).filter(Boolean);
};

// Where every truck is, in ONE call. Their endpoint is bulk, so a second and a
// third tracker cost nothing over the first — which is what makes this scale
// past the one van it is being switched on for.
export async function pajLastPositions(deviceIds = []) {
  const ids = [...new Set(deviceIds.map((d) => String(d).trim()).filter(Boolean))];
  if (!ids.length) return [];
  const json = await authed('/trackerdata/getalllastpositions', {
    method: 'POST',
    body: { deviceIDs: ids.map((d) => (/^\d+$/.test(d) ? Number(d) : d)) }
  });
  return shape(json, ids.length === 1 ? ids[0] : null);
}

// Everything the device recorded between two moments — what the backfill reads.
// PAJ keeps the history whether or not anybody here was watching, so the trail
// can be complete even for the hours nobody had the board open.
export async function pajRange(deviceId, fromMs, toMs) {
  const id = String(deviceId || '').trim();
  if (!id) return [];
  const json = await authed(`/trackerdata/${encodeURIComponent(id)}/date_range`, {
    method: 'POST',
    body: {
      dateStart: Math.floor(Number(fromMs) / 1000),
      dateEnd: Math.floor(Number(toMs) / 1000),
      wifi: 0,
      gps: 1
    }
  });
  return shape(json, id);
}
