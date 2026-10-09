// The marketplace's rules as arithmetic. NO IMPORTS — the vendor dashboard shows
// the same clocks and the same payout breakdown in the browser, and the server
// recomputes them; both must come from one definition. See docs/marketplace/PLAN.md.
//
// Money here is INTEGER CENTS. Parsing dollars into floats is how $1,061.95
// becomes $1,061.9499.

export const ACCEPT_HOURS = 24;           // from the moment the vendor is notified
export const READY_HOURS = 72;            // from e-transfer confirmation (same start)
export const STRIKE_LIMIT = 3;            // active strikes before the vendor is restricted
export const STRIKE_REVIEW_DAYS = 90;     // an unrevised strike resurfaces for review this often
export const DEFAULT_COMMISSION_BPS = 1000; // 10%
export const WARRANTY_MONTHS = 12;        // every unit, vendor-backed (owner, 2026-10-08)
export const WARRANTY_RESERVE_BPS = 200;  // 2% of each payout, held WARRANTY_RESERVE_MONTHS
export const WARRANTY_RESERVE_MONTHS = 12;
export const LANE_C_VENDOR_SHARE_BPS = 8000; // vendor keeps 80% of the customer's delivery fee

// Money out. The hold is how long after DELIVERY a sale stays pending, by tier (PLAN §5.4).
export const HOLD_DAYS_BY_TIER = { 0: 14, 1: 7, 2: 3 };
export const holdDaysFor = (tier) => HOLD_DAYS_BY_TIER[tier] ?? HOLD_DAYS_BY_TIER[0];
export const MIN_PAYOUT_CENTS = 5000;      // below $50 waits for the next run (proposal)
export const FOUR_EYES_CENTS = 200000;     // at/above $2,000 the approver must not be the proposer
export const BANK_COOLING_DAYS = 5;        // a CHANGED bank account is not paid to for this long

export const STRIKE_REASONS = {
  missed_accept: 'Did not accept the order within 24 hours',
  missed_ready: 'Order not ready (or tracking not submitted) within 72 hours',
  cancelled_order: 'Cancelled a paid order',
  not_as_described: 'Unit not as described',
  missed_handover: 'Missed the agreed handover window',
  warranty_response: 'Missed a warranty-claim deadline',
  off_platform_contact: 'Steered a customer off the platform',
  review_manipulation: 'Review manipulation',
  document_falsification: 'Falsified documents',
  other: 'Other (explained)'
};

export const VENDOR_STATUSES = ['applied', 'approved', 'restricted', 'suspended', 'terminated', 'rejected'];
export const TIERS = { 0: 'Probation', 1: 'Standard', 2: 'Trusted' };

/** May this vendor sell new units right now? Restricted means no new sales. */
export const canSell = (status) => status === 'approved';
/** Lane C (vendor ships) is Standard tier and above. */
export const canSelfShip = (tier) => Number(tier) >= 1;

const HOUR = 3600 * 1000;
const at = (v) => (v instanceof Date ? v : new Date(v));

/**
 * The two clocks on a paid order. `confirmedAt` is when WE confirmed the
 * e-transfer — the vendor is not told about an order before that, so an unpaid
 * order can never be accepted, missed or struck.
 *
 * Times come from the server's own timestamps. A vendor's browser clock never
 * decides a strike.
 */
export function orderClocks({ confirmedAt, acceptedAt = null, readyAt = null, now = new Date() }) {
  if (!confirmedAt) return { started: false };
  const start = at(confirmedAt).getTime();
  const t = at(now).getTime();
  const acceptBy = new Date(start + ACCEPT_HOURS * HOUR);
  const readyBy = new Date(start + READY_HOURS * HOUR);
  const state = (done, deadline) => {
    if (done) return at(done).getTime() <= deadline.getTime() ? 'met' : 'late';
    const left = deadline.getTime() - t;
    if (left < 0) return 'overdue';
    return left < 6 * HOUR ? 'urgent' : 'ok';
  };
  return {
    started: true,
    acceptBy, readyBy,
    accept: state(acceptedAt, acceptBy),
    ready: state(readyAt, readyBy),
    acceptHoursLeft: acceptedAt ? null : Math.floor((acceptBy.getTime() - t) / HOUR * 10) / 10,
    readyHoursLeft: readyAt ? null : Math.floor((readyBy.getTime() - t) / HOUR * 10) / 10
  };
}

/** The banner a vendor sees: derived from status and the number of ACTIVE strikes. */
export function standing({ status, activeStrikes }) {
  if (status === 'restricted') return 'restricted';
  if (status !== 'approved') return status;
  if (activeStrikes >= STRIKE_LIMIT - 1) return 'at_risk';
  if (activeStrikes >= 1) return 'warning';
  return 'good';
}

export const toCents = (dollars) => Math.round(Number(dollars) * 100);
export const fromCents = (cents) => Math.round(cents) / 100;

/** Commission on the item price only — never on delivery or HST. Rounds half up. */
export const commissionCents = (itemCents, bps) => Math.round((itemCents * bps) / 10000);

/**
 * The customer's delivery fee in Lane C, split in whole cents. The vendor keeps
 * `LANE_C_VENDOR_SHARE_BPS` of it; the rounding remainder goes to Bargain Bay so
 * the two halves add back to exactly what the customer paid.
 */
export function splitLaneCDelivery(feeCents, vendorBps = LANE_C_VENDOR_SHARE_BPS) {
  const vendor = Math.floor((feeCents * vendorBps) / 10000);
  return { vendor, platform: feeCents - vendor };
}

/**
 * What a vendor is paid for one order, line by line, so the statement can show
 * every deduction. All inputs are pre-tax cents.
 *   itemCents            the vendor's price for the unit
 *   commissionBps        in force on the order date
 *   deliveryServiceCents the vendor delivery service fee (Lanes A/B, 0 in Lane C)
 *   insuranceCents       premium if the vendor chose insurance, else 0
 *   laneCDeliveryCents   the vendor's share of the customer's delivery fee (Lane C)
 */
export function payoutBreakdown({
  itemCents, commissionBps = DEFAULT_COMMISSION_BPS,
  deliveryServiceCents = 0, insuranceCents = 0, laneCDeliveryCents = 0,
  reserveBps = WARRANTY_RESERVE_BPS
}) {
  const commission = commissionCents(itemCents, commissionBps);
  const gross = itemCents + laneCDeliveryCents;
  const net = gross - commission - deliveryServiceCents - insuranceCents;
  // The reserve comes off what the vendor would otherwise be paid. Never negative.
  const reserve = net > 0 ? Math.round((net * reserveBps) / 10000) : 0;
  return {
    itemCents, laneCDeliveryCents, commission, deliveryServiceCents, insuranceCents,
    netBeforeReserve: net, reserve, payable: net - reserve
  };
}

/** A unit must always carry the full year. The listing field cannot be lower. */
export const warrantyOk = (months) => Number(months) >= WARRANTY_MONTHS;

/**
 * Is this strike due for the periodic management review? Unrevised strikes
 * resurface STRIKE_REVIEW_DAYS after they were issued or last reviewed.
 */
export function strikeDueForReview({ lastReviewAt, revisedAt }, now = new Date()) {
  if (revisedAt) return false;
  return at(now).getTime() - at(lastReviewAt).getTime() >= STRIKE_REVIEW_DAYS * 24 * HOUR;
}
