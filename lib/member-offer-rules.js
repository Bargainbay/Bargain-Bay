// Pure rules for member offers (no imports; the form uses them too).
export const OFFER_HOLD_HOURS = 48;          // members
export const PUBLIC_HOLD_HOURS = 24;         // everyone else
export const PUBLIC_MARGIN_PCT = 25;         // a public offer must clear cost + 25%
export const MAX_PUBLIC_OFFERS_PER_IP_DAY = 10;
// A unit is OPEN TO OFFERS to the public only when its listed price sits well above the public floor, i.e. there is real room to
// say yes. A unit we paid a lot for is already priced to go; an offer button on it only sets up a refusal.
export const MIN_OFFER_ROOM_PCT = 8;         // room must be at least 8% of the price...
export const MIN_OFFER_ROOM_USD = 40;        // ...and at least $40
// Refurbished units are the department we want moved (owner, 2026-11-14): they are open to offers on a much lower bar, as long as
// there is SOME room above the floor. Without any room every offer would be refused, so the button would only invite a "no".
export const REFURB_MIN_ROOM_PCT = 3;
export const REFURB_MIN_ROOM_USD = 20;
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

/** The floor for a public offer: cost + PUBLIC_MARGIN_PCT (ceil, as every floor here), or the consignment floor if higher. */
export function publicOfferFloor({ cost = 0, consignFloor = 0 } = {}) {
  const c = Number(cost) || 0;
  const pct = c > 0 ? Math.ceil(Math.round(c * (1 + PUBLIC_MARGIN_PCT / 100) * 100) / 100) : 0;
  return Math.max(pct, Number(consignFloor) || 0);
}
export const holdHoursFor = (kind) => (kind === 'public' ? PUBLIC_HOLD_HOURS : OFFER_HOLD_HOURS);

/** Is there enough room between the public price and the public floor to make an offer worth inviting? */
export function hasOfferRoom({ price, floor, refurbished = false }) {
  const p = Number(price) || 0;
  if (p <= 0) return false;
  const room = p - (Number(floor) || 0);
  const usd = refurbished ? REFURB_MIN_ROOM_USD : MIN_OFFER_ROOM_USD;
  const pct = refurbished ? REFURB_MIN_ROOM_PCT : MIN_OFFER_ROOM_PCT;
  return room >= Math.max(usd, p * pct / 100);
}
