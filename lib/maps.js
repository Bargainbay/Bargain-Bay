// Client-side Google Maps JS loader for address autocomplete on the invoice form.
// Entirely optional: with no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY the loader resolves
// null and the form keeps its plain text address fields. The key is public by
// design (restrict it to your domain + the Places API in the Google console).
//
// NOTE: NEXT_PUBLIC_* vars are inlined at build time — after adding the key in
// Vercel, redeploy for autocomplete to switch on.
export const mapsKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Google does NOT fail the script when it rejects a key. The <script> loads,
// `onload` fires, `new google.maps.Map()` constructs happily — and then the map
// draws nothing, because the key was refused for this referrer, or the Maps
// JavaScript API isn't enabled on the project, or billing isn't on. The only
// signal is a console line and a call to this global.
//
// Without it a rejected key is indistinguishable from a working one with
// nothing to draw: a blank grey box, on a screen whose entire job is to show
// somebody where their van is. Every consumer of a map should be able to say
// WHY there isn't one.
let _authFailed = false;
const _authWatchers = new Set();

export const mapsAuthFailed = () => _authFailed;

// Subscribe to the rejection. Returns an unsubscribe. Fires immediately if it
// has already happened — a second map mounted later must not sit there blank
// waiting for an event that came and went.
export function onMapsAuthFailure(fn) {
  if (_authFailed) { try { fn(); } catch { /* noop */ } }
  _authWatchers.add(fn);
  return () => _authWatchers.delete(fn);
}

if (typeof window !== 'undefined') {
  window.gm_authFailure = () => {
    _authFailed = true;
    console.error(
      '[maps] Google rejected the Maps key for', window.location.host,
      '— check the key\'s HTTP-referrer restrictions, that the Maps JavaScript API is enabled, and that billing is on.'
    );
    _authWatchers.forEach((f) => { try { f(); } catch { /* noop */ } });
  };
}

let _loading = null;

// Resolves to google.maps once the Places library is ready, or null if there's
// no key / it can't load. Safe to call repeatedly — the script loads once.
// Ensure the Maps JS script is on the page and the Places library has been
// REQUESTED. Resolves to google.maps (or null without a key / on load failure).
// Note: with loading=async the Places library finishes loading slightly AFTER
// this resolves, so callers should poll google.maps.places before using it
// (see placesReady) rather than trusting it to be ready the instant this returns.
export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const key = mapsKey();
  if (!key) return Promise.resolve(null);
  const kick = () => { try { window.google?.maps?.importLibrary?.('places'); } catch { /* noop */ } };
  if (window.google?.maps) { kick(); return Promise.resolve(window.google.maps); }
  if (_loading) return _loading;
  _loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    s.async = true;
    s.onload = () => { kick(); resolve(window.google?.maps || null); };
    s.onerror = () => { _loading = null; resolve(null); };
    document.head.appendChild(s);
  });
  return _loading;
}

// Poll until the (async-loaded) Places Autocomplete class is actually available.
// Returns google.maps.places, or null after the timeout.
export async function placesReady(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.google?.maps?.places?.Autocomplete) return window.google.maps.places;
    await new Promise((r) => setTimeout(r, 100));
  }
  return window.google?.maps?.places?.Autocomplete ? window.google.maps.places : null;
}
