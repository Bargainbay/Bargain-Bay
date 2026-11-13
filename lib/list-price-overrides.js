// A list price typed by a person that WINS over the tracker's (Retail x Condition %) price.
//
// The importer works a unit's price out itself from the tracker's Retail and Condition %, so a number
// typed into the sheet's Suggested Sale Price cell never reaches the site (found 2026-11-13). This is
// the way to raise (or set) one unit's list price without falsifying its Retail or Condition.
//
//   settings key list_price_overrides:  { "<SKU>": { price, tracker } }
//   price   = what the site lists the unit at
//   tracker = what the sheet said the last time we looked, so "back to tracker price" is always known
//
// It sits UNDER everything else: clearance, member pricing and the consignment floor still apply to the
// price it produces, because they all read products.price.
import { getSettingStrict, setSetting } from './settings';
import { query } from './db';

const KEY = 'list_price_overrides';
const money2 = (n) => Math.round(Number(n) * 100) / 100;

export function cleanOverrides(raw) {
  const out = {};
  for (const [sku, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const price = money2(v?.price);
    const tracker = money2(v?.tracker);
    if (sku && price > 0 && tracker > 0) out[sku] = { price, tracker };
  }
  return out;
}

// PURE. Applies the overrides to a freshly parsed tracker read. Returns the units with the typed price
// and the overrides with `tracker` refreshed to what the sheet says now (changed = whether any moved).
export function applyOverrides(units, overrides) {
  const next = { ...overrides };
  let changed = false;
  const out = (units || []).map((u) => {
    const o = overrides[u.id];
    if (!o) return u;
    if (money2(u.price) !== o.tracker) { next[u.id] = { ...o, tracker: money2(u.price) }; changed = true; }
    return { ...u, price: o.price };
  });
  return { units: out, overrides: next, changed };
}

export async function getListOverrides() {
  return cleanOverrides(await getSettingStrict(KEY, null));
}

// The sync's door. A failed read leaves the sheet's prices untouched rather than failing the sync.
export async function applyListPriceOverrides(units) {
  let current;
  try { current = await getListOverrides(); } catch { return units; }
  if (!Object.keys(current).length) return units;
  const r = applyOverrides(units, current);
  if (r.changed) { try { await setSetting(KEY, r.overrides); } catch { /* best effort */ } }
  return r.units;
}

// Sets the override and moves the live row now, so nobody has to press Sync to see it.
export async function setListOverride(sku, price, trackerPrice) {
  const p = money2(price);
  const cur = await getListOverrides();
  const tracker = cur[sku]?.tracker ?? money2(trackerPrice);
  if (!(p > 0)) return { error: 'Enter a price greater than zero.' };
  if (p <= tracker + 0.004) return { error: `That is not above the tracker price of ${tracker.toFixed(2)}.` };
  await setSetting(KEY, { ...cur, [sku]: { price: p, tracker } });
  await query('UPDATE products SET price = $2 WHERE sku = $1', [sku, p]);
  return { ok: true, price: p, tracker, before: cur[sku]?.price ?? null };
}

// Removes it and puts the tracker price back on the live row. Returns the tracker price, or null if none.
export async function removeListOverride(sku) {
  const cur = await getListOverrides();
  const o = cur[sku];
  if (!o) return null;
  const next = { ...cur };
  delete next[sku];
  await setSetting(KEY, next);
  await query('UPDATE products SET price = $2 WHERE sku = $1', [sku, o.tracker]);
  return o.tracker;
}
