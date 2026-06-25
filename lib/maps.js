// Client-side Google Maps JS loader for address autocomplete on the invoice form.
// Entirely optional: with no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY the loader resolves
// null and the form keeps its plain text address fields. The key is public by
// design (restrict it to your domain + the Places API in the Google console).
//
// NOTE: NEXT_PUBLIC_* vars are inlined at build time — after adding the key in
// Vercel, redeploy for autocomplete to switch on.
export const mapsKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

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
