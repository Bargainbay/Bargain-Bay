// The member price knobs, and what is allowed to be typed into them. NO imports: the admin screen
// runs the same checks in the browser that the server runs before it saves.
//
// These four numbers were constants in lib/pricing.js, so changing what a reseller pays meant a
// deploy. They are stored as settings now (lib/member-rates.js) and these are the DEFAULTS —
// what applies until somebody saves a change, and what applies if the settings cannot be read.

export const DEFAULT_MEMBER_RATES = Object.freeze({
  regularRate: 0.55,   // a member pays this share of RETAIL on regular stock
  clearanceRate: 0.90, // a member pays this share of the CLEARANCE price
  costFloor: 1.10,     // and never less than cost x this
  minProfit: 200       // and never leaves us less than this clear, where the unit can carry it
});

// Hard limits, so a slip of the finger cannot put the whole shop on sale or lock members out.
// costFloor >= 1 is the one that matters: below it a member could be sold something under cost.
export const MEMBER_RATE_LIMITS = Object.freeze({
  regularRate: [0.30, 1.00],
  clearanceRate: [0.50, 1.00],
  costFloor: [1.00, 2.00],
  minProfit: [0, 2000]
});

export const MEMBER_RATE_LABELS = Object.freeze({
  regularRate: 'Regular stock: member pays this % of retail',
  clearanceRate: 'Clearance: member pays this % of the clearance price',
  costFloor: 'Floor: never below cost plus this %',
  minProfit: 'Floor: never leave us less than this many dollars clear'
});

// Rates are stored as the multipliers pricing.js uses; the screen shows percentages. Rounded to
// four places so 55 -> 0.55 does not come back as 0.5500000000000001.
export const toPercent = (m) => Math.round(Number(m) * 10000) / 100;
export const fromPercent = (p) => Math.round(Number(p) * 100) / 10000;

// Returns { rates } on success or { error } naming the field. Fields left out keep `base`.
export function normalizeRates(input, base = DEFAULT_MEMBER_RATES) {
  const out = { ...base };
  for (const key of Object.keys(DEFAULT_MEMBER_RATES)) {
    if (input?.[key] === undefined || input?.[key] === null || input?.[key] === '') continue;
    const n = Number(input[key]);
    const [lo, hi] = MEMBER_RATE_LIMITS[key];
    if (!Number.isFinite(n) || n < lo - 1e-9 || n > hi + 1e-9) {
      const show = key === 'minProfit' ? (v) => `$${v}` : (v) => `${toPercent(v)}%${key === 'costFloor' ? ' of cost' : ''}`;
      return { error: `${MEMBER_RATE_LABELS[key]} must be between ${show(lo)} and ${show(hi)}.` };
    }
    out[key] = key === 'minProfit' ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
  }
  return { rates: out };
}

export function normalizeOverridePrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}
