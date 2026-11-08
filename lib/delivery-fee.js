// Server side of distance-based delivery pricing: the owner's catalog prices, and the driving
// distance from our warehouse. The pure rules live in lib/delivery-zones.js.
//
// Every failure degrades to "distance unknown" (Zone A, flagged) and never throws — delivery
// pricing must not be able to take checkout down.
import { hasDb, query } from './db';
import { drivingKm } from './pickup-distance';
import { DELIVERY_ZONES, deliveryFeeForKm } from './delivery-zones';

export async function loadZoneOverrides() {
  if (!hasDb()) return {};
  try {
    const { rows } = await query(
      `SELECT name, default_price, active FROM services WHERE lower(name) = ANY($1) ORDER BY active DESC, id DESC`,
      [DELIVERY_ZONES.map((z) => z.name.toLowerCase())]);
    const out = {};
    for (const r of rows) {
      const z = DELIVERY_ZONES.find((x) => x.name.toLowerCase() === String(r.name).toLowerCase());
      if (!z || out[z.name]) continue;
      out[z.name] = { price: r.default_price == null ? null : Number(r.default_price), active: r.active !== false };
    }
    return out;
  } catch { return {}; }
}

// A repeat lookup (the quote, then the checkout itself) must not pay for Google twice.
const CACHE = new Map();
const TTL_MS = 10 * 60 * 1000;
const keyOf = ({ address, city, postal }) => [address, city, postal].map((s) => String(s || '').trim().toLowerCase()).join('|');

export async function kmFor(addr) {
  const k = keyOf(addr);
  const hit = CACHE.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.km;
  const r = await drivingKm(addr).catch(() => null);
  const km = r && Number.isFinite(r.km) ? r.km : null;
  if (km != null) {                       // never cache a failure: the next try may work
    if (CACHE.size > 500) CACHE.clear();
    CACHE.set(k, { km, at: Date.now() });
  }
  return km;
}

/** The delivery fee for ONE of our shipments to this address, priced from the catalog. */
export async function quoteDelivery(addr) {
  const [km, overrides] = await Promise.all([kmFor(addr), loadZoneOverrides()]);
  return deliveryFeeForKm(km, overrides);
}
