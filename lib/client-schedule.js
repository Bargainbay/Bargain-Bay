// The "when and in what order" view a client sees for their upcoming stops.
// No imports: it runs on the server page and is unit-tested on its own.
//
// A route is one driver's run for one day, in the order the dispatcher put it
// (jobs.seq), falling back to the promised window, then to entry order. Stops
// with nobody assigned yet are grouped together and ordered by window alone —
// they are scheduled but the run is not built, and the page says so.
const OPEN = (s) => !['done', 'failed', 'cancelled', 'unscheduled'].includes(s);

export function buildSchedule(jobs) {
  const days = new Map();
  for (const j of jobs || []) {
    if (!OPEN(j.status) || !j.date) continue;
    if (!days.has(j.date)) days.set(j.date, new Map());
    const runs = days.get(j.date);
    const key = j.driverId ? `d${j.driverId}` : 'none';
    if (!runs.has(key)) runs.set(key, { key, driverName: j.driverName || null, driver2Name: j.driver2Name || null, assigned: !!j.driverId, stops: [] });
    runs.get(key).stops.push(j);
  }
  const cmp = (a, b) =>
    (a.seq ?? 1e9) - (b.seq ?? 1e9)
    || String(a.windowStart || '99:99').localeCompare(String(b.windowStart || '99:99'))
    || a.id - b.id;
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, runs]) => ({
      date,
      routes: [...runs.values()]
        .sort((a, b) => (b.assigned - a.assigned) || String(a.driverName || '').localeCompare(String(b.driverName || '')))
        .map((r, i) => ({ ...r, label: r.assigned ? `Route ${String.fromCharCode(65 + i)}` : 'Route to be confirmed', stops: r.stops.sort(cmp), mapsUrl: mapsUrl(r.stops.sort(cmp)) }))
    }));
}

// A Google Maps directions link through the run's addresses, in order. Google
// accepts up to 9 waypoints in a URL; a longer run is cut and the label says so.
export function mapsUrl(stops) {
  const addrs = stops.map((s) => s.address).filter(Boolean);
  if (addrs.length < 1) return null;
  const q = (a) => encodeURIComponent(a);
  const used = addrs.slice(0, 11);
  const dest = used[used.length - 1];
  const via = used.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&destination=${q(dest)}${via.length ? `&origin=${q(via[0])}` : ''}${via.length > 1 ? `&waypoints=${via.slice(1).map(q).join('%7C')}` : ''}&travelmode=driving`;
}

export const windowText = (j) => (j.windowStart ? `${j.windowStart}${j.windowEnd ? `–${j.windowEnd}` : ''}` : 'Time to be confirmed');
