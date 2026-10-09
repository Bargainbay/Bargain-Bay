// A new seller's progress from approval to first payout, worked out from what is actually on record —
// never from a tick box a person could forget. See docs/marketplace/PLAN.md §12 and the Getting Started guide.
import { query } from './db';
import { pendingPolicies } from './policy-acceptance';

/**
 * Pure: the steps, in order, from a plain state object. `bank` is 'none' | 'pending' | 'verified'.
 * The first step not yet done is `next`.
 */
export function onboardingSteps(s) {
  const steps = [
    { key: 'policies', label: 'Accept the marketplace policies', done: s.policiesPending === 0,
      note: s.policiesPending ? `${s.policiesPending} still to accept` : null, href: '/vendor/policies' },
    { key: 'bank', label: 'Add your banking details', done: s.bank === 'verified',
      note: s.bank === 'pending' ? 'submitted — we are verifying it' : null, href: '/vendor/payouts' },
    { key: 'listing', label: 'Start your first listing', done: s.listings >= 1, href: '/vendor/listings' },
    { key: 'submitted', label: 'Submit it for review', done: s.submitted >= 1,
      note: s.listings >= 1 && s.submitted < 1 ? 'a draft is waiting for you' : null, href: '/vendor/listings' },
    { key: 'live', label: 'Get a unit on sale', done: s.onSale >= 1,
      note: s.awaitingCheckin ? 'approved — bring it to our warehouse so we can put it on sale' : s.inReview ? 'in review with us' : null, href: '/vendor/listings' },
    { key: 'order', label: 'Fulfil your first order', done: s.delivered >= 1,
      note: s.openOrders ? `${s.openOrders} open — check the countdown` : null, href: '/vendor/orders' },
    { key: 'payout', label: 'Receive your first payout', done: s.paid >= 1, href: '/vendor/payouts' }
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length, next: steps.find((x) => !x.done) || null };
}

/** The state for one seller. Every read is for THIS vendor only (the id comes from their session). */
export async function onboardingState(vendorId) {
  const one = async (sql, args = [vendorId]) => Number((await query(sql, args)).rows[0]?.n || 0);
  const [listings, submitted, onSale, awaiting, inReview, delivered, openOrders, paid] = await Promise.all([
    one(`SELECT count(*) AS n FROM marketplace_listings WHERE vendor_id = $1`),
    one(`SELECT count(*) AS n FROM marketplace_listings WHERE vendor_id = $1 AND status <> 'draft' AND status <> 'withdrawn'`),
    one(`SELECT count(*) AS n FROM marketplace_listings WHERE vendor_id = $1 AND status IN ('live','reserved','sold')`),
    one(`SELECT count(*) AS n FROM marketplace_listings WHERE vendor_id = $1 AND status = 'awaiting_checkin'`),
    one(`SELECT count(*) AS n FROM marketplace_listings WHERE vendor_id = $1 AND status = 'in_review'`),
    one(`SELECT count(*) AS n FROM vendor_orders WHERE vendor_id = $1 AND status = 'delivered'`),
    one(`SELECT count(*) AS n FROM vendor_orders WHERE vendor_id = $1 AND status IN ('awaiting_accept','accepted','ready')`),
    one(`SELECT count(*) AS n FROM vendor_payouts WHERE vendor_id = $1 AND status = 'paid'`)
  ]);
  const { rows: bank } = await query(
    `SELECT bool_or(status = 'verified') AS verified, bool_or(status = 'pending') AS pending FROM vendor_bank_accounts WHERE vendor_id = $1`, [vendorId]);
  const policiesPending = (await pendingPolicies(vendorId)).length;
  return {
    policiesPending, bank: bank[0]?.verified ? 'verified' : bank[0]?.pending ? 'pending' : 'none',
    listings, submitted, onSale, awaitingCheckin: awaiting, inReview, delivered, openOrders, paid
  };
}

export async function onboardingProgress(vendorId) {
  return onboardingSteps(await onboardingState(vendorId));
}
