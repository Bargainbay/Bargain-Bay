// Pure rules for member offers (no imports; the form uses them too).
export const OFFER_HOLD_HOURS = 48;
export const MAX_OPEN_OFFERS = 5;
export const MAX_OFFERS_PER_DAY = 15;
export const LIVE = ['open', 'countered', 'accepted'];

/** The floor an offer must clear: cost + 10% / $200 clear (costFloor), the consignment floor, and never under cost. */
export function offerFloor({ cost = 0, memberFloor = 0, consignFloor = 0 } = {}) {
  return Math.max(Number(cost) || 0, Number(memberFloor) || 0, Number(consignFloor) || 0);
}

/** Returns an error string, or '' when the offer may be filed. `memberPrice` is what this member would pay today. */
export function offerProblem({ amount, memberPrice, floor }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return 'Enter the amount you want to offer.';
  if (a >= memberPrice) return 'That is at or above your current price, so just add it to your order.';
  if (a < floor) return 'That is lower than we can accept on this unit. Try a higher offer.';
  return '';
}
