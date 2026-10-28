// Where the member price knobs live: the settings table, read through a short cache so a price
// page does not pay a query per unit. Same shape as lib/staff.js — a failed read keeps the last
// good answer instead of snapping every reseller back to the defaults.
//
//   member_rates           { regularRate, clearanceRate, costFloor, minProfit }
//   member_price_overrides { "<SKU>": <member price> }   layered over data/member-prices.json
//
// The floor and the ceiling in lib/pricing.js still bound whatever is saved here, so an override
// typed too low is lifted to cost + the floor and one typed too high is capped at the public price.
import { getSettingStrict, setSetting } from './settings';
import { DEFAULT_MEMBER_RATES, normalizeRates, normalizeOverridePrice } from './member-rate-rules';

const TTL_MS = 30 * 1000;
let cache = null; // { at, rates, overrides }

const DEFAULTS = { rates: { ...DEFAULT_MEMBER_RATES }, overrides: {} };

export function clearMemberRatesCache() { cache = null; }

export async function getMemberRates() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const [stored, ov] = await Promise.all([
      getSettingStrict('member_rates', null),
      getSettingStrict('member_price_overrides', null)
    ]);
    // A stored value that no longer validates is ignored field by field, never trusted.
    const checked = stored ? normalizeRates(stored) : null;
    const rates = checked?.rates || { ...DEFAULT_MEMBER_RATES };
    const overrides = {};
    for (const [sku, v] of Object.entries(ov && typeof ov === 'object' ? ov : {})) {
      const p = normalizeOverridePrice(v);
      if (p) overrides[sku] = p;
    }
    cache = { at: Date.now(), rates, overrides };
    return cache;
  } catch {
    // No database (tests, a build) or a blip: keep what we had, else the documented defaults.
    return cache || { at: 0, ...DEFAULTS };
  }
}

export async function saveMemberRates(input) {
  const cur = await getMemberRates();
  const r = normalizeRates(input, cur.rates);
  if (r.error) return r;
  await setSetting('member_rates', r.rates);
  clearMemberRatesCache();
  return { rates: r.rates, before: cur.rates };
}

export async function setOverride(sku, price) {
  const s = String(sku || '').trim();
  const p = normalizeOverridePrice(price);
  if (!s) return { error: 'SKU required.' };
  if (!p) return { error: 'Enter a member price greater than zero.' };
  const cur = await getMemberRates();
  await setSetting('member_price_overrides', { ...cur.overrides, [s]: p });
  clearMemberRatesCache();
  return { ok: true, before: cur.overrides[s] ?? null, price: p };
}

export async function removeOverride(sku) {
  const s = String(sku || '').trim();
  const cur = await getMemberRates();
  if (!(s in cur.overrides)) return { ok: true, removed: false };
  const next = { ...cur.overrides };
  delete next[s];
  await setSetting('member_price_overrides', next);
  clearMemberRatesCache();
  return { ok: true, removed: true, before: cur.overrides[s] };
}
