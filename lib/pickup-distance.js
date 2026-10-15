// Driving distance from our Pickering warehouse to a vendor's pickup address, for the Lane B zone.
//
// Uses Google's Routes API (the Maps key family this app already uses for Places). It needs a SERVER
// key: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ships in the browser bundle and is referrer-restricted, which
// a server call does not satisfy. Set GOOGLE_MAPS_SERVER_KEY (Routes API enabled; restrict it by API,
// not by referrer).
//
// BEST-EFFORT AND NEVER INVENTED: no key, a timeout, an unfindable address or a bad reply all return
// null, and the listing then needs a staff member to type the distance at review. A guessed distance
// would set a price.
import { PICKUP_ADDRESS } from './constants';

const TIMEOUT_MS = 6000;

export function distanceLookupConfigured() { return !!process.env.GOOGLE_MAPS_SERVER_KEY; }

export async function drivingKm({ address, city, postal }) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  const dest = [address, city, postal, 'Canada'].filter((x) => x && String(x).trim()).join(', ');
  if (!key || !String(address || '').trim()) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters' },
      body: JSON.stringify({ origin: { address: PICKUP_ADDRESS }, destination: { address: dest }, travelMode: 'DRIVE', units: 'METRIC' })
    });
    if (!res.ok) return null;
    const meters = (await res.json())?.routes?.[0]?.distanceMeters;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return { km: Math.round(meters / 100) / 10, source: 'google' };
  } catch { return null; } finally { clearTimeout(timer); }
}
