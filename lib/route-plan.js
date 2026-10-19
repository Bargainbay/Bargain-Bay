// Put a day's stops in driving order, starting from a base.
//
// OPEN path, not a loop: the van leaves the base and ends wherever the last
// stop is. Travel times come from Google's Routes API (computeRouteMatrix, by
// address — no geocoding step, no stored coordinates needed). With no
// GOOGLE_MAPS_SERVER_KEY or a failed call it falls back to straight-line
// distance between city centres and SAYS SO in `source: 'approx'` — an
// approximate order labelled as one beats no order, but it must never pass for
// a real one. A stop in a city we cannot place goes to the END and is reported
// in `unplaced`, never guessed.
//
// A promise to a customer outranks the shortest route: stops with a window
// start are kept in window order (early ones first, "after 5PM" ones last), and
// only stops that share a window are shuffled among themselves.
import { query, withTransaction } from './db';
import { ROUTE_BASES } from './constants';

const TIMEOUT_MS = 12000;
const MAX_STOPS = 24;       // computeRouteMatrix allows 25 origins/destinations; one is the base

// City centres, for the keyless fallback only.
const CITY_XY = {
  kitchener: [43.4516, -80.4925], waterloo: [43.4643, -80.5204], cambridge: [43.3616, -80.3144],
  guelph: [43.5448, -80.2482], 'new hamburg': [43.3796, -80.7066], baden: [43.4, -80.6667],
  breslau: [43.4725, -80.4206], branchton: [43.3667, -80.3667], elmira: [43.6, -80.55],
  'st jacobs': [43.5333, -80.55], 'st. jacobs': [43.5333, -80.55], conestogo: [43.5333, -80.5],
  hespeler: [43.4, -80.3167], ayr: [43.2833, -80.45], paris: [43.1944, -80.3844],
  stratford: [43.37, -81.0], woodstock: [43.1306, -80.7467], brantford: [43.1394, -80.2644],
  fergus: [43.7, -80.3667], elora: [43.6833, -80.4333], milton: [43.5183, -79.8774],
  burlington: [43.3255, -79.799], hamilton: [43.2557, -79.8711], oakville: [43.4675, -79.6877],
  mississauga: [43.589, -79.6441], brampton: [43.7315, -79.7624], toronto: [43.6532, -79.3832],
  pickering: [43.8384, -79.0868], ajax: [43.8509, -79.0204], whitby: [43.8975, -78.9429],
  oshawa: [43.8971, -78.8658], markham: [43.8561, -79.337], vaughan: [43.8361, -79.4983]
};
const cityKey = (c) => String(c || '').toLowerCase().replace(/,.*$/, '').replace(/\s+/g, ' ').trim();
const xyOf = (city) => CITY_XY[cityKey(city)] || null;
function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fullAddress = (s) => [s.address, s.city, s.postal, 'Canada'].filter((x) => x && String(x).trim()).join(', ');

// Returns { cost[i][j], km[i][j], min[i][j], source } over [base, ...stops], or null.
async function googleMatrix(addresses) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const wp = addresses.map((a) => ({ waypoint: { address: a } }));
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST', signal: ctl.signal,
      headers: {
        'content-type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition'
      },
      body: JSON.stringify({ origins: wp, destinations: wp, travelMode: 'DRIVE' })
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const n = addresses.length;
    const cost = Array.from({ length: n }, () => Array(n).fill(null));
    const km = Array.from({ length: n }, () => Array(n).fill(null));
    const min = Array.from({ length: n }, () => Array(n).fill(null));
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.condition && r.condition !== 'ROUTE_EXISTS') continue;
      const secs = parseInt(String(r.duration || '').replace('s', ''), 10);
      if (!Number.isFinite(secs)) continue;
      cost[r.originIndex][r.destinationIndex] = secs;
      min[r.originIndex][r.destinationIndex] = secs / 60;
      km[r.originIndex][r.destinationIndex] = (r.distanceMeters || 0) / 1000;
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i === j) { cost[i][j] = 0; km[i][j] = 0; min[i][j] = 0; }
    return { cost, km, min, source: 'google' };
  } catch { return null; } finally { clearTimeout(timer); }
}

function approxMatrix(points) {
  const n = points.length;
  const km = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : haversineKm(points[i], points[j]) * 1.3)));
  const min = km.map((r) => r.map((d) => (d / 60) * 60));
  return { cost: km, km, min, source: 'approx' };
}

// Shortest open path from `start` through `idx` (indices into cost). Exact for
// up to 11 stops, nearest-neighbour + 2-opt beyond that.
function bestPath(cost, start, idx) {
  const n = idx.length;
  if (n <= 1) return idx.slice();
  if (n <= 11) {
    const full = (1 << n) - 1;
    const dp = Array.from({ length: 1 << n }, () => Array(n).fill(Infinity));
    const par = Array.from({ length: 1 << n }, () => Array(n).fill(-1));
    for (let i = 0; i < n; i++) dp[1 << i][i] = cost[start][idx[i]];
    for (let m = 1; m <= full; m++) for (let l = 0; l < n; l++) {
      const cur = dp[m][l];
      if (cur === Infinity || !(m & (1 << l))) continue;
      for (let nx = 0; nx < n; nx++) {
        if (m & (1 << nx)) continue;
        const nm = m | (1 << nx), v = cur + cost[idx[l]][idx[nx]];
        if (v < dp[nm][nx]) { dp[nm][nx] = v; par[nm][nx] = l; }
      }
    }
    let last = 0;
    for (let i = 1; i < n; i++) if (dp[full][i] < dp[full][last]) last = i;
    const out = []; let m = full;
    while (last >= 0) { out.push(idx[last]); const p = par[m][last]; m &= ~(1 << last); last = p; }
    return out.reverse();
  }
  const left = idx.slice(); const path = []; let at = start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (cost[at][left[i]] < cost[at][left[bi]]) bi = i;
    at = left.splice(bi, 1)[0]; path.push(at);
  }
  const len = (p) => p.reduce((s, v, i) => s + cost[i ? p[i - 1] : start][v], 0);
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) for (let j = i + 1; j < path.length; j++) {
      const cand = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
      if (len(cand) < len(path) - 1e-9) { path.splice(0, path.length, ...cand); improved = true; }
    }
  }
  return path;
}

// stops: [{ id, address, city, postal, windowStart }]
export async function planRoute(stops, baseKey = 'cda', firstId = null) {
  const base = ROUTE_BASES.find((b) => b.key === baseKey) || ROUTE_BASES[0];
  const list = (stops || []).slice(0, MAX_STOPS);
  if (!list.length) return { base, order: [], legs: [], totalKm: 0, totalMin: 0, source: null, unplaced: [] };

  let m = await googleMatrix([base.address, ...list.map(fullAddress)]);
  let unplaced = [];
  if (!m) {
    const pts = [xyOf(base.city), ...list.map((s) => xyOf(s.city))];
    const placed = list.map((_, i) => !!pts[i + 1]);
    unplaced = list.filter((_, i) => !placed[i]).map((s) => s.id);
    m = approxMatrix(pts.map((p) => p || xyOf(base.city) || [43.45, -80.49]));
  }

  // Tier by the promise made: morning windows, then anything-goes, then late.
  const tier = (s) => (!s.windowStart ? 1 : s.windowStart <= '10:00' ? 0 : 2);
  // A stop pinned first (the big load that has to go on the truck first, say) is
  // placed before anything else, and the rest is routed on from there.
  const pin = firstId == null ? 0 : list.findIndex((s) => String(s.id) === String(firstId)) + 1;
  const idxAll = list.map((_, i) => i + 1).filter((i) => i !== pin && !unplaced.includes(list[i - 1].id));
  const groups = [];
  for (const t of [0, 1, 2]) {
    const inTier = idxAll.filter((i) => tier(list[i - 1]) === t);
    const starts = [...new Set(inTier.map((i) => list[i - 1].windowStart || ''))].sort();
    for (const st of starts) groups.push(inTier.filter((i) => (list[i - 1].windowStart || '') === st));
  }
  let at = 0; const seq = [];
  if (pin && !unplaced.includes(list[pin - 1].id)) { seq.push(pin); at = pin; }
  for (const g of groups) { const p = bestPath(m.cost, at, g); seq.push(...p); if (p.length) at = p[p.length - 1]; }

  const legs = []; let prev = 0, totalKm = 0, totalMin = 0;
  for (const i of seq) {
    const km = m.km[prev][i] ?? 0, min = m.min[prev][i] ?? 0;
    legs.push({ id: list[i - 1].id, km: Math.round(km * 10) / 10, min: Math.round(min) });
    totalKm += km; totalMin += min; prev = i;
  }
  const order = [...seq.map((i) => list[i - 1].id), ...unplaced];
  return { base, order, legs, totalKm: Math.round(totalKm * 10) / 10, totalMin: Math.round(totalMin), source: m.source, unplaced };
}

// Plan and SAVE the order for a set of stops. Writes `seq` and nothing else.
export async function routeJobs(jobIds, baseKey = 'cda', firstId = null) {
  const ids = (jobIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return { order: [], legs: [] };
  const { rows } = await query(
    `SELECT id, address, city, postal, window_start FROM jobs
      WHERE id = ANY($1::int[]) AND status NOT IN ('done','failed','cancelled')`, [ids]);
  const stops = rows.map((r) => ({
    id: r.id, address: r.address, city: r.city, postal: r.postal,
    windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null
  }));
  const plan = await planRoute(stops, baseKey, firstId);
  if (plan.order.length) {
    await withTransaction(async (client) => {
      for (let i = 0; i < plan.order.length; i++) await client.query('UPDATE jobs SET seq = $2 WHERE id = $1', [plan.order[i], i + 1]);
    });
  }
  return plan;
}

// A day's column on the board: one driver's open stops, or the unassigned ones.
export async function routeDay(date, driverId, baseKey = 'cda', firstId = null) {
  const { rows } = await query(
    `SELECT id FROM jobs WHERE job_date = $1 AND driver_id IS NOT DISTINCT FROM $2
        AND status NOT IN ('done','failed','cancelled')`, [date, driverId ? Number(driverId) : null]);
  return routeJobs(rows.map((r) => r.id), baseKey, firstId);
}
