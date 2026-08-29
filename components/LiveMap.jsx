'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, mapsKey, onMapsAuthFailure } from '../lib/maps';
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

export default function LiveMap() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [focus, setFocus] = useState(null);
  const box = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map());
  // Why there is no map, when there isn't one. 'ok' covers both "drawing" and
  // "still loading" — a map that is merely slow must not accuse anybody of a
  // misconfigured key.
  const [mapProblem, setMapProblem] = useState('');

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
    // Google calls gm_authFailure AFTER the script has loaded successfully, so
    // this is the only way to hear about a refused key. Subscribed before the
    // load starts, because the rejection can arrive the moment it finishes.
    const stop = onMapsAuthFailure(() => { if (!dead) setMapProblem('rejected'); });
    loadGoogleMaps().then((g) => {
      if (dead) return;
      // A null here is the script itself never arriving — no key (handled
      // separately below), an ad blocker, or no network.
      if (!g) { setMapProblem('unreachable'); return; }
      if (!box.current || map.current) return;
      map.current = new g.Map(box.current, {
        center: { lat: 43.8354, lng: -79.0849 },  // the warehouse, until a van reports in
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });
    });
    return () => { dead = true; stop(); };
  }, []);

  useEffect(() => {
    const g = typeof window !== 'undefined' ? window.google?.maps : null;
    if (!g || !map.current || !data) return;
    const bounds = new g.LatLngBounds();
    let any = false;
    for (const d of data.drivers) {
      if (d.lat == null || d.lng == null) continue;
      any = true;
      const at = { lat: d.lat, lng: d.lng };
      bounds.extend(at);
      let m = markers.current.get(d.id);
      if (!m) {
        m = new g.Marker({ map: map.current });
        markers.current.set(d.id, m);
      }
      m.setPosition(at);
      m.setTitle(`${d.name} — ${ago(d.ageSeconds)}`);
      // Fresh reads as solid; stale reads as an outline. Same shape, so the map
      // never has to be squinted at to tell which is which.
      m.setIcon({
        path: g.SymbolPath.CIRCLE,
        scale: d.fresh ? 9 : 7,
        fillColor: d.fresh ? '#0E223B' : '#ffffff',
        fillOpacity: 1,
        strokeColor: d.fresh ? '#ffffff' : '#9a9a9a',
        strokeWeight: d.fresh ? 3 : 2
      });
      m.setLabel(d.fresh
        ? { text: d.name.slice(0, 1).toUpperCase(), color: '#fff', fontSize: '11px', fontWeight: '700' }
        : null);
    }
    // Drivers who have never reported keep no marker.
    for (const [id, m] of markers.current) {
      if (!data.drivers.some((d) => d.id === id && d.lat != null)) { m.setMap(null); markers.current.delete(id); }
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
  const live = drivers.filter((d) => d.fresh).length;

  return (
    <div>
      <div className="notice-box" style={{ marginTop: 0 }}>
        <b>A phone can only report while the app is open.</b> iPhones and Android both suspend a web page
        the moment the screen locks or the driver switches to Maps, so expect a position at every stop and
        gaps in between — not a dot moving down the road. Anything older than {data?.freshMinutes || 5} minutes
        is shown as a last known position, never as where they are now.
      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="live-wrap">
        <div className="live-list">
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

        {!mapsKey() ? (
          <div className="live-map live-map-off">
            <p className="hint">
              No <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>, so there is no map — the list above still
              works, and every row opens the position in Google Maps.
            </p>
          </div>
        ) : (
          // The box stays mounted whatever goes wrong: the ref has to exist for
          // the map to attach to, and swapping it out for a message would mean
          // a map that recovers has nowhere to draw. The reason sits ON it.
          <div className="live-map-wrap">
            <div className="live-map" ref={box} />
            {mapProblem && (
              <div className="live-map-why">
                {mapProblem === 'rejected' ? (
                  <>
                    <b>Google rejected the Maps key for this site.</b>
                    <p className="hint">
                      The key works, but not from <code>{typeof window !== 'undefined' ? window.location.host : 'this host'}</code>.
                      In the Google Cloud console, on that key: add this host to the HTTP-referrer
                      restrictions, check the <b>Maps JavaScript API</b> is enabled (Places being enabled
                      is not enough), and check billing is on.
                    </p>
                  </>
                ) : (
                  <>
                    <b>The map couldn&apos;t load.</b>
                    <p className="hint">
                      Google&apos;s script never arrived — usually an ad blocker or no connection.
                    </p>
                  </>
                )}
                <p className="hint">
                  The list on the left is unaffected, and every row opens the position in Google Maps.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
