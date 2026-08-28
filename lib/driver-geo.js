// The driver's phone, reporting where it is.
//
// Deliberately NOT part of lib/driver-outbox.js. That queue exists so a tap in a
// basement is never lost, and it replays forever until the server takes it —
// which is exactly the wrong policy for a position. A stale fix replayed as
// though it were current is worse than no fix at all, so this keeps its own
// small buffer, drops the oldest when it overflows, and every ping carries the
// timestamp the DEVICE recorded so the server can age it honestly.
//
// What it cannot do: run in the background. `watchPosition` lives and dies with
// the page, and iOS suspends JavaScript the instant the screen locks or the
// driver switches to Maps. There is no web API that fixes this. See the header
// of lib/driver-location.js.
const SEND_EVERY_MS = 45000;   // no more than one round trip a minute or so
const MOVED_METRES = 100;      // ...unless the van has actually gone somewhere
const MAX_BUFFER = 60;         // ~45 minutes of history; older is dropped

let watchId = null;
let buffer = [];
let lastSentAt = 0;
let lastFix = null;
let timer = null;
let getJobId = () => null;
let onChange = () => {};

export const geoSupported = () =>
  typeof navigator !== 'undefined' && 'geolocation' in navigator;

const metres = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const t = (d) => (d * Math.PI) / 180;
  const dLat = t(b.lat - a.lat);
  const dLng = t(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

async function flush(force = false) {
  if (!buffer.length) return;
  const now = Date.now();
  if (!force && now - lastSentAt < SEND_EVERY_MS) return;
  const batch = buffer;
  buffer = [];
  lastSentAt = now;
  try {
    const res = await fetch('/api/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pings: batch, jobId: getJobId() })
    });
    if (!res.ok) throw new Error(String(res.status));
    onChange({ state: 'on', at: now });
  } catch {
    // Put it back, newest last, and let the cap throw away the oldest. A driver
    // out of signal for an hour should send the last twenty minutes when they
    // come back, not the first.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
    onChange({ state: 'queued', queued: buffer.length });
  }
}

function onPosition(pos) {
  const c = pos.coords || {};
  const fix = { lat: c.latitude, lng: c.longitude };
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return;
  buffer.push({
    lat: fix.lat, lng: fix.lng,
    accuracy: c.accuracy, speed: c.speed, heading: c.heading,
    at: pos.timestamp || Date.now(),
    jobId: getJobId(),
    source: 'watch'
  });
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  // Send on a timer OR as soon as the van has actually moved — sitting at a
  // customer's door for forty minutes should not cost forty round trips, and
  // pulling away should show up before the next scheduled one.
  const moved = metres(lastFix, fix) > MOVED_METRES;
  lastFix = fix;
  flush(moved);
  onChange({ state: 'on', fix });
}

function onError(err) {
  // 1 = permission denied. Everything else is transient (no signal indoors,
  // a timeout) and the watcher stays up.
  onChange({ state: err?.code === 1 ? 'denied' : 'searching', message: err?.message || '' });
}

export function startSharing({ jobId, onStatus } = {}) {
  if (!geoSupported()) { onStatus?.({ state: 'unsupported' }); return false; }
  getJobId = typeof jobId === 'function' ? jobId : () => jobId || null;
  onChange = onStatus || (() => {});
  if (watchId !== null) return true;
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 15000,
    timeout: 30000
  });
  // A van drives back into signal without firing any event, and a phone parked
  // on a doorstep may not produce a new fix for minutes.
  timer = setInterval(() => flush(false), SEND_EVERY_MS);
  onChange({ state: 'starting' });
  return true;
}

// Take a fix RIGHT NOW, and send it, without waiting for the watcher's next
// callback.
//
// This is what makes the gaps have ends. The page stops running the moment the
// driver switches to Google Maps, so the drive itself is invisible — but the two
// instants either side of it are not: the tap that sends them to Maps, and the
// moment they come back to the app. Sampling both turns "we have no idea where
// he was for 25 minutes" into "he left the depot at 9:04 and was at the
// customer's road at 9:29", which is most of what the office actually wanted to
// know and costs one extra fix.
export function markNow(reason = 'event') {
  if (!geoSupported()) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const c = pos.coords || {};
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      buffer.push({
        lat: c.latitude, lng: c.longitude,
        accuracy: c.accuracy, speed: c.speed, heading: c.heading,
        at: pos.timestamp || Date.now(),
        jobId: getJobId(),
        source: 'event'
      });
      lastFix = { lat: c.latitude, lng: c.longitude };
      flush(true);
    },
    () => { /* no fix to be had; the watcher keeps trying */ },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
  );
}

export function stopSharing() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (timer) { clearInterval(timer); timer = null; }
  // One last go while the page is still alive. `keepalive` is what lets it
  // survive the tab being closed; it is capped at 64KB, which a handful of
  // coordinates is nowhere near.
  if (buffer.length) {
    try {
      navigator.sendBeacon?.(
        '/api/driver/location',
        new Blob([JSON.stringify({ pings: buffer, jobId: getJobId() })], { type: 'application/json' })
      );
      buffer = [];
    } catch { /* nothing to be done */ }
  }
  onChange({ state: 'off' });
}

export const isSharing = () => watchId !== null;
