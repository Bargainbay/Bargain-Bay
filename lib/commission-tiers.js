// The business-development rep's daily commission. PURE — no imports — shared by the server, the
// Home page's live tracker, and the tests.
//
// From the Employment Agreement (4.2), applied to the day's Eligible Collected Sales (ex-HST):
//     $10,000 or less ... no commission
//     over $10,000 ...... 1%   of the WHOLE day's total
//     over $20,000 ...... 1.5% of the whole day's total
//     over $30,000 ...... 2%   of the whole day's total
// The rate applies to the whole day, not just the part above the line, so it is a cliff.
//
// THE AGREEMENT CONTRADICTS ITSELF AT EXACTLY $30,000: the rule says "over $30,000" (so $30,000.00
// earns 1.5% = $450), but its worked example says "a day with $30,000 ... earns $600" (2%). The
// default follows the RULE, as written. `inclusive: true` on a tier makes its line count ("$30,000 or
// more"), which is what reproduces the example. It is a setting, not a constant, so the owner can
// decide once the lawyer has seen it. Money is in integer cents inside, to keep $0.01 days honest.

export const DEFAULT_TIERS = [
  { over: 10000, pct: 1 },
  { over: 20000, pct: 1.5 },
  { over: 30000, pct: 2 }
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
