// The pay rules for commission, in one place with NO imports (the dashboard cards
// run in the browser too).
//
// REPS (in-house, owner 2026-10-26): 10% of the day's gross profit, but only on a day
// that reaches $3,000. It is a CLIFF, not a marginal rate: $2,999 pays nothing,
// $3,000 pays $300, $4,200 pays $420. That is the owner's wording of the plan
// ("10% over $3000" meaning once the day is over $3,000) and the arithmetic in the
// job post ($3,000 a day = $300). If the plan changes, change it HERE and the
// card, the month figure and the team table all follow.
export const REP_COMMISSION_PCT = 10;
export const REP_COMMISSION_THRESHOLD = 3000;

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** What a rep earns for one day, from that day's gross profit. */
export function repCommission(grossProfit) {
  const gp = cents(grossProfit);
  return gp >= REP_COMMISSION_THRESHOLD ? cents(gp * REP_COMMISSION_PCT / 100) : 0;
}

// AFFILIATES (owner 2026-10-26): 5% of the sale, on the goods (pre-tax, after any
// discount, delivery excluded). A $10,000 stove pays $500.
export const AFFILIATE_DEFAULT_PCT = 5;
// Returns policy: a change-of-mind return is allowed for 14 days after receipt, so
// a commission only becomes payable once that window has closed. Paying on the
// day of delivery means clawing money back from a person who owes us nothing.
export const AFFILIATE_HOLD_DAYS = 14;
// What the customer who types an affiliate's code gets by default. The coupon
// system will not hold a code that takes nothing off, so there has to be SOME
// discount; admin can change it per affiliate when approving.
export const AFFILIATE_CUSTOMER_PCT = 3;
// Lowest payout worth an e-transfer. Below it the balance simply carries.
export const AFFILIATE_MIN_PAYOUT = 50;

export const affiliateCommission = (base, pct = AFFILIATE_DEFAULT_PCT) =>
  cents(Math.max(0, Number(base) || 0) * (Number(pct) || 0) / 100);

/**
 * Where one affiliate sale stands. Pure, so the dashboard, the admin screen and
 * the payout all say the same thing.
 *   void       the order was cancelled or refunded: nothing is owed
 *   waiting    the order is not settled/delivered yet
 *   hold       delivered, still inside the return window (payableOn says when)
 *   payable    delivered and the window has closed
 */
export function affiliateSaleState({ status, deliveredOn, today }) {
  if (status === 'cancelled' || status === 'refunded') return { state: 'void', payableOn: null };
  if (status !== 'delivered' || !deliveredOn) return { state: 'waiting', payableOn: null };
  const d = new Date(`${String(deliveredOn).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + AFFILIATE_HOLD_DAYS);
  const payableOn = d.toISOString().slice(0, 10);
  return { state: String(today) >= payableOn ? 'payable' : 'hold', payableOn };
}
