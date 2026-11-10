// The business-development rep's daily commission. PURE — no imports — shared by the server, the
// Home page's live tracker, and the tests.
//
// From the Employment Agreement (4.2), applied to the day's Eligible Collected Sales (ex-HST).
// Owner's tiers, 2026-11-10 (replacing 1% over $10k / 1.5% over $20k / 2% over $30k):
//     $5,000 or less ... no commission
//     over $5,000 ...... 1%   of the WHOLE day's total
//     over $10,000 ..... 1.5% of the whole day's total
//     over $20,000 ..... 2%   of the whole day's total
//     over $30,000 ..... 3%   of the whole day's total
// The rate applies to the whole day, not just the part above the line, so it is a cliff.
//
// "OVER" IS THE DEFAULT READING of every line (the agreement has always said "over"). The owner wrote
// "1% at $5,000"; if a day of exactly $5,000 should pay, tick "or more" on that tier on the admin screen
// (`inclusive: true`). The agreement text (lib/employment-terms.js) is built from whatever tiers are in
// force, so what he signs always says what the system pays. The agreement's old worked example paid a
// $30,000 day 2% while its rule paid 1.5% — the example now uses a day that sits clear of every line.
// It is a setting, not a constant. Money is in integer cents inside, to keep $0.01 days honest.

export const DEFAULT_TIERS = [
  { over: 5000, pct: 1 },
  { over: 10000, pct: 1.5 },
  { over: 20000, pct: 2 },
  { over: 30000, pct: 3 }
];

const toCents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

/** Clean a tier list from settings: ascending, numeric, nothing negative; falls back to the default. */
export function normalizeTiers(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((t) => ({ over: Number(t?.over), pct: Number(t?.pct), inclusive: !!t?.inclusive }))
    .filter((t) => Number.isFinite(t.over) && t.over >= 0 && Number.isFinite(t.pct) && t.pct >= 0 && t.pct <= 100)
    .sort((a, b) => a.over - b.over);
  return list.length ? list : DEFAULT_TIERS.map((t) => ({ ...t, inclusive: false }));
}

const reaches = (net, t) => (t.inclusive ? toCents(net) >= toCents(t.over) : toCents(net) > toCents(t.over));

/** The tier a day's total reaches, and what it pays. A negative or empty day pays nothing. */
export function tieredCommission(net, tiers = DEFAULT_TIERS) {
  const list = normalizeTiers(tiers);
  const cents = Math.max(0, toCents(net));
  let hit = null;
  for (const t of list) if (reaches(cents / 100, t)) hit = t;
  const pct = hit ? hit.pct : 0;
  return { net: cents / 100, pct, commission: Math.round((cents * pct) / 100) / 100, tier: hit };
}

/** The next tier up from a day's total: how far away it is, and what crossing it would pay. */
export function nextTier(net, tiers = DEFAULT_TIERS) {
  const list = normalizeTiers(tiers);
  const cur = tieredCommission(net, list);
  const next = list.find((t) => t.pct > cur.pct && !reaches(net, t));
  if (!next) return null;
  // "Over $X" needs one cent more than X; "$X or more" needs exactly X.
  const target = next.inclusive ? next.over : (toCents(next.over) + 1) / 100;
  const moreNeeded = Math.max(0, Math.round((toCents(target) - toCents(net))) / 100);
  return { over: next.over, pct: next.pct, moreNeeded, wouldPay: tieredCommission(target, list).commission };
}
