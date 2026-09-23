'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, mapsKey } from '../lib/maps';
import { formatPhone } from '../lib/constants';

// Where the vans are, now.
//
// The honest part of this screen is the AGE on every row. A position is the one
// thing where stale and wrong are the same thing, so nothing here draws an old
// fix as a current one: fresh is solid and dark, anything past the freshness
// window is hollow and grey and says how long ago it was. A dot that lies about
// being live is worse than no dot, because somebody rings a customer on it.
const ago = (s) => {
  if (s == null) return 'never';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const REFRESH_MS = 20000;

// A blunt rectangle for a truck. Drawn rather than taken from SymbolPath because
// that set is circles and arrows, and the whole point is a silhouette that is
// not a driver's dot.
const VAN_PATH = 'M -9,-6 L 9,-6 L 9,6 L -9,6 Z';

export default function LiveMap() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [focus, setFocus] = useState(null);
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/admin/dispatch?view=live', { cache: 'no-store' }).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setErr('');
      setData(d);
    } catch { setErr('Network error — this may be out of date.'); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // The map is optional. With no key the list still works, and the list is the
  // part that actually answers "where is Ruban" — the map only makes it quicker.
  useEffect(() => {
    let dead = false;
    loadGoogleMaps().then((g) => {
      if (dead || !g || !box.current || map.current) return;
      map.current = new g.Map(box.current, {
        center: { lat: 43.8354, lng: -79.0849 },  // the warehouse, until a van reports in
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });
    });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const g = typeof window !== 'undefined' ? window.google?.maps : null;
    if (!g || !map.current || !data) return;
    const bounds = new g.LatLngBounds();
    let any = false;
    const alive = new Set();
    // A PHONE is a circle and a TRUCK is a rectangle, and they must not be told
    // apart by colour alone: the two say different things (where the person is,
    // where the van is) and they legitimately disagree the moment a driver walks
    // a fridge up a driveway. Two dots the same shape at two ends of a street is
    // a map nobody can read.
    const plot = (key, subject, shape) => {
      if (subject.lat == null || subject.lng == null) return;
      any = true;
      alive.add(key);
      const at = { lat: subject.lat, lng: subject.lng };
      bounds.extend(at);
      let m = markers.current.get(key);
      if (!m) {
        m = new g.Marker({ map: map.current });
        markers.current.set(key, m);
      }
      m.setPosition(at);
      m.setTitle(`${subject.name} — ${ago(subject.ageSeconds)}`);
      // Fresh reads as solid; stale reads as an outline. Same shape, so the map
      // never has to be squinted at to tell which is which.
      m.setIcon({
        path: shape === 'van' ? VAN_PATH : g.SymbolPath.CIRCLE,
        scale: shape === 'van' ? 1 : (subject.fresh ? 9 : 7),
        fillColor: subject.fresh ? (shape === 'van' ? '#1d6b3f' : '#0E223B') : '#ffffff',
        fillOpacity: 1,
        strokeColor: subject.fresh ? '#ffffff' : '#9a9a9a',
        strokeWeight: subject.fresh ? 3 : 2
      });
      m.setLabel(subject.fresh
        ? { text: subject.name.slice(0, 1).toUpperCase(), color: '#fff', fontSize: '11px', fontWeight: '700' }
        : null);
    };

    for (const d of data.drivers) plot(`d${d.id}`, d, 'phone');
    for (const v of (data.vehicles || [])) plot(`v${v.id}`, v, 'van');

    // Anything that has never reported keeps no marker. Keys are namespaced, or
    // driver 3 and van 3 would share one and flicker between two positions.
    for (const [key, m] of markers.current) {
      if (!alive.has(key)) { m.setMap(null); markers.current.delete(key); }
    }
    if (any && !map.current.__framed) { map.current.fitBounds(bounds, 60); map.current.__framed = true; }
  }, [data]);

  useEffect(() => {
    const g = typeof window !== 'undefined' ? window.google?.maps : null;
    if (!g || !map.current || !focus) return;
    map.current.panTo({ lat: focus.lat, lng: focus.lng });
    map.current.setZoom(14);
  }, [focus]);

  const drivers = data?.drivers || [];
  const vans = data?.vehicles || [];
  const live = drivers.filter((d) => d.fresh).length;
  const vansLive = vans.filter((v) => v.fresh).length;
  const tracker = data?.tracker || null;

  return (
    <div>
      <div className="notice-box" style={{ marginTop: 0 }}>
        <b>A phone can only report while the app is open.</b> iPhones and Android both suspend a web page
        the moment the screen locks or the driver switches to Maps, so expect a position at every stop and
        gaps in between — not a dot moving down the road. Anything older than {data?.freshMinutes || 5} minutes
        is shown as a last known position, never as where they are now.
      </div>

      {err && <div className="error-box">{err}</div>}

      {/* A tracker that has stopped being read looks exactly like a van that has
          been parked since Friday, which is the whole reason this line exists —
          the same silence CDA's watcher sat in for months. */}
      {tracker?.lastFail && tracker.tracked > 0 && (
        <div className="error-box">
          <b>The van tracker is not being read.</b> {tracker.lastFail.reason}{' '}
          Positions below are the last that reached us — the van may well have moved since.
        </div>
      )}

      <div className="live-wrap">
        <div className="live-list">
          {/* The vans come FIRST because they are the reliable half: a tracker
              reports whether or not anybody's phone is awake, so on most
              afternoons this is the only list that answers "where is the truck".
              Kept as its own list rather than merged into the drivers — see
              vehiclePositions() for why the two are never folded together. */}
          {vans.length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                <b>Vans</b> · {vansLive} of {vans.length} reporting now
              </p>
              {vans.map((v) => (
                <button key={`v${v.id}`} type="button"
                  className={'live-row is-van' + (v.fresh ? ' is-live' : '') + (v.lat == null ? ' is-none' : '')}
                  disabled={v.lat == null}
                  onClick={() => setFocus({ lat: v.lat, lng: v.lng })}>
                  <span className="live-dot" aria-hidden="true" />
                  <span className="live-who">
                    <b>{v.name}</b>{v.plate ? ` · ${v.plate}` : ''}
                    <span className="live-when">
                      {v.lat == null ? 'never reported' : ago(v.ageSeconds)}
                      {v.fresh && v.speed != null && v.speed > 3 && ` · ${Math.round(v.speed)} km/h`}
                      {/* A flat tracker is the quietest way this stops working. */}
                      {v.battery != null && v.battery <= 20 && ` · battery ${v.battery}%`}
                    </span>
                    {/* Who has it, off the open shift — this ATTRIBUTES the van,
                        it does not claim the person is standing next to it. */}
                    {v.crew && <span className="live-job">{v.crew} on shift in it</span>}
                  </span>
                  {v.lat != null && (
                    <a className="live-open" onClick={(e) => e.stopPropagation()}
                      href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
                      target="_blank" rel="noopener noreferrer">open ↗</a>
                  )}
                </button>
              ))}
              <p className="hint">
                <b>A van reports on its own</b>, app or no app — roughly every few minutes while it is
                moving, and it sleeps when parked, so a stationary truck goes quiet rather than
                disappearing. Anything older than {data?.vanFreshMinutes || 15} minutes is shown as a last
                known position.
              </p>
              <p className="hint" style={{ marginTop: 16 }}><b>Drivers&apos; phones</b></p>
            </>
          )}
          <p className="hint" style={{ marginTop: 0 }}>
            {live} of {drivers.length} reporting now · refreshes every {REFRESH_MS / 1000}s
          </p>
          {drivers.length === 0 && <p className="hint">No drivers on the roster.</p>}
          {drivers.map((d) => (
            <button key={d.id} type="button"
              className={'live-row' + (d.fresh ? ' is-live' : '') + (d.lat == null ? ' is-none' : '')}
              disabled={d.lat == null}
              onClick={() => setFocus({ lat: d.lat, lng: d.lng })}>
              <span className="live-dot" aria-hidden="true" />
              <span className="live-who">
                <b>{d.name}</b>
                <span className="live-when">
                  {d.lat == null ? 'never reported' : ago(d.ageSeconds)}
                  {d.fresh && d.speed != null && d.speed > 3 && ` · ${Math.round(d.speed)} km/h`}
                  {d.accuracy != null && d.fresh && d.accuracy > 100 && ` · ±${Math.round(d.accuracy)}m`}
                </span>
                {d.onJob && (
                  <span className="live-job">
                    {d.onJob.status === 'arrived' ? 'At ' : 'Heading to '}
                    {d.onJob.customerName || d.onJob.jobNumber}
                    {d.onJob.where ? ` · ${d.onJob.where}` : ''}
                  </span>
                )}
              </span>
              {d.lat != null && (
                <a className="live-open" onClick={(e) => e.stopPropagation()}
                  href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
                  target="_blank" rel="noopener noreferrer">open ↗</a>
              )}
              {d.phone && (
                <a className="live-call" onClick={(e) => e.stopPropagation()} href={`tel:${d.phone}`}>
                  {formatPhone(d.phone)}
                </a>
              )}
            </button>
          ))}
        </div>

        {mapsKey()
          ? <div className="live-map" ref={box} />
          : (
            <div className="live-map live-map-off">
              <p className="hint">
                No <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>, so there is no map — the list above still
                works, and every row opens the position in Google Maps.
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
