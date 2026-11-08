// Delivery pricing by distance from our Pickering warehouse. PURE — no imports — because the
// checkout page previews the fee in the browser and /api/checkout prices it again on the server.
//
// Prices are the "RS Solutions Delivery Rate Sheet 2026" zones. The owner changes one in the
// service price catalog (/admin/sales-services): a service with the zone's NAME overrides its
// price. A zone with no price keeps the rate-sheet price — delivery must always be chargeable,
// so switching a zone "off" in the catalog does not stop checkout charging for delivery.
//
//   Zone A 0–50 km $95 · Zone B 51–100 km $140 · Zone C 101–150 km $225
//   Beyond Zone C: Zone C plus $2 for each km past 150 (one way, the sheet's own rule).
//   Distance unknown (no key, lookup failed, address not found): Zone A, flagged `verified: false`
//   so staff check the address — an invented distance would set a price.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const DELIVERY_ZONES = [
  { zone: 'A', name: 'Delivery – Zone A', maxKm: 50, fee: 95, label: 'Zone A (0–50 km)' },
  { zone: 'B', name: 'Delivery – Zone B', maxKm: 100, fee: 140, label: 'Zone B (51–100 km)' },
  { zone: 'C', name: 'Delivery – Zone C', maxKm: 150, fee: 225, label: 'Zone C (101–150 km)' }
];
export const PER_KM_BEYOND = 2;

function priceOf(z, overrides) {
  const o = overrides?.[z.name];
  return o && o.price != null && Number.isFinite(Number(o.price)) && Number(o.price) >= 0 ? round2(o.price) : z.fee;
}

/**
 * @param {number|null} km driving distance from Pickering, or null when unknown
 * @param {Record<string,{price:number|null,active:boolean}>} overrides from the service catalog
 * @returns {{ fee:number, zone:string, label:string, km:number|null, verified:boolean }}
 */
export function deliveryFeeForKm(km, overrides = {}) {
  const a = DELIVERY_ZONES[0];
  const n = km == null || km === '' ? NaN : Number(km);
  if (!Number.isFinite(n) || n < 0) {
    return { fee: priceOf(a, overrides), zone: a.zone, label: `${a.label} — distance not verified`, km: null, verified: false };
  }
  for (const z of DELIVERY_ZONES) {
    if (n <= z.maxKm) return { fee: priceOf(z, overrides), zone: z.zone, label: z.label, km: n, verified: true };
  }
  const c = DELIVERY_ZONES[DELIVERY_ZONES.length - 1];
  const extraKm = Math.ceil(n - c.maxKm);
  return {
    fee: round2(priceOf(c, overrides) + extraKm * PER_KM_BEYOND), zone: 'beyond',
    label: `${Math.round(n)} km (Zone C + $${PER_KM_BEYOND}/km past ${c.maxKm} km)`, km: n, verified: true
  };
}

/**
 * What the delivery line comes to. Everything WE move is one shipment, priced by distance
 * (`zoneFee`); each marketplace seller who ships their own unit (lane C) is another, at the
 * flat `flatFee` — they do not ship from Pickering, so distance from it means nothing.
 */
export function deliveryTotal(items = [], zoneFee, flatFee) {
  const laneC = new Set();
  let ours = false;
  for (const u of items) {
    if (u?.marketplace && u.lane === 'C') laneC.add(u.vendor?.id); else ours = true;
  }
  const shipments = (ours ? 1 : 0) + laneC.size;
  return { shipments, ours, total: round2((ours ? zoneFee : 0) + laneC.size * flatFee) };
}
