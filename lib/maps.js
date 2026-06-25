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
export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const key = mapsKey();
  if (!key) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps);
  if (_loading) return _loading;
  _loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    s.async = true;
    s.onload = () => resolve(window.google?.maps || null);
    s.onerror = () => { _loading = null; resolve(null); };
    document.head.appendChild(s);
  });
  return _loading;
}
