// Zones for collecting a vendor's unit (Lane B). NO IMPORTS: the admin screen uses it too.
//
// The bands are the ones the shipping policy already publishes for the CUSTOMER'S delivery, measured
// from the Pickering warehouse, so one idea of "how far" runs through the whole business:
//   zone 1: 0-50 km   zone 2: 51-100 km   zone 3: 101-150 km   beyond that: no collection (zone 4)
// A unit more than 150 km away is not offered as Lane B — the vendor ships it (Lane C) or brings it (A).

export const ZONES = [
  { zone: 1, label: '0–50 km', maxKm: 50 },
  { zone: 2, label: '51–100 km', maxKm: 100 },
  { zone: 3, label: '101–150 km', maxKm: 150 }
];
export const SIZE_CLASSES = ['small', 'standard', 'oversize'];
export const MAX_COLLECTION_KM = 150;

/** null when the distance is unknown or beyond what we collect. 50.0 is zone 1 (the policy says 0-50). */
export function zoneForKm(km) {
  if (km == null || km === '' || !Number.isFinite(Number(km)) || Number(km) < 0) return null;
  const n = Number(km);
  for (const z of ZONES) if (n <= z.maxKm) return z.zone;
  return null;
}

// STARTER schedule, in cents. It is the customer's zone fee ($79 / $125 / $175) scaled by how many
// people and how much van the unit takes. It is a starting point for the owner to adjust against the
// dispatch Profit tab's real cost per stop — NOT a measured cost — and the admin screen labels it so
// until a row is saved.
const BASE = { 1: 7900, 2: 12500, 3: 17500 };
const MULT = { small: 0.75, standard: 1, oversize: 1.5 };
export const STARTER_ZONE_RATES = Object.fromEntries(
  ZONES.map((z) => [z.zone, Object.fromEntries(SIZE_CLASSES.map((s) => [s, Math.round((BASE[z.zone] * MULT[s]) / 500) * 500]))])
);

/**
 * rows: [{ zone, size_class, cents }] from the table. Saved rows win cell by cell; every other cell
 * is the starter. `isStarter[zone][size]` says which, so the screen never presents a guess as a decision.
 */
export function zoneRateTable(rows = []) {
  const rates = {}; const isStarter = {};
  for (const z of ZONES) {
    rates[z.zone] = {}; isStarter[z.zone] = {};
    for (const s of SIZE_CLASSES) { rates[z.zone][s] = STARTER_ZONE_RATES[z.zone][s]; isStarter[z.zone][s] = true; }
  }
  for (const r of rows) {
    if (rates[r.zone] && SIZE_CLASSES.includes(r.size_class)) { rates[r.zone][r.size_class] = Number(r.cents); isStarter[r.zone][r.size_class] = false; }
  }
  return { rates, isStarter };
}

/** The fee for one unit, or null if it is outside the zones (the caller must treat that as 'cannot collect'). */
export function collectionFeeCents(table, km, sizeClass) {
  const zone = zoneForKm(km);
  if (!zone || !SIZE_CLASSES.includes(sizeClass)) return null;
  return table.rates[zone][sizeClass];
}
