// Marketplace foundation: the rules (pure) and the vendor tables (real Postgres).
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  orderClocks, standing, commissionCents, splitLaneCDelivery, payoutBreakdown,
  warrantyOk, strikeDueForReview, canSell, canSelfShip, toCents
} from '../lib/marketplace-rules.js';
import {
  createApplication, decideApplication, grantVendorUser, revokeVendorUser, vendorAccess,
  commissionBpsFor, setCommission, issueStrike, reviseStrike, reinstateVendor,
  strikesAwaitingReview, markStrikeReviewed, strikeMeter, slugify
} from '../lib/vendors.js';

const H = 3600 * 1000;
const t0 = new Date('2026-10-10T12:00:00Z');
const plus = (h) => new Date(t0.getTime() + h * H);

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

suite('marketplace rules — clocks, strikes, money');

test('the clocks start at payment confirmation; none before it', () => {
  equal(orderClocks({ confirmedAt: null }).started, false);
  const c = orderClocks({ confirmedAt: t0, now: plus(1) });
  equal(c.acceptBy.toISOString(), plus(24).toISOString());
  equal(c.readyBy.toISOString(), plus(72).toISOString());
  equal(c.accept, 'ok');
});

test('accept and ready are met, late, urgent or overdue off server timestamps', () => {
  equal(orderClocks({ confirmedAt: t0, now: plus(19) }).accept, 'urgent');       // under 6h left
  equal(orderClocks({ confirmedAt: t0, now: plus(25) }).accept, 'overdue');
  equal(orderClocks({ confirmedAt: t0, acceptedAt: plus(23), now: plus(30) }).accept, 'met');
  equal(orderClocks({ confirmedAt: t0, acceptedAt: plus(26), now: plus(30) }).accept, 'late');
  equal(orderClocks({ confirmedAt: t0, acceptedAt: plus(5), readyAt: plus(71), now: plus(80) }).ready, 'met');
  equal(orderClocks({ confirmedAt: t0, acceptedAt: plus(5), now: plus(73) }).ready, 'overdue');
});

test('the 72 hours include the 24: a vendor who takes 24h to accept has 48 left', () => {
  const c = orderClocks({ confirmedAt: t0, now: plus(24) });
  equal(c.readyHoursLeft, 48);
});

test('standing: good, warning, at risk, restricted — and unrevised strikes are what count', () => {
  equal(standing({ status: 'approved', activeStrikes: 0 }), 'good');
  equal(standing({ status: 'approved', activeStrikes: 1 }), 'warning');
  equal(standing({ status: 'approved', activeStrikes: 2 }), 'at_risk');
  equal(standing({ status: 'restricted', activeStrikes: 3 }), 'restricted');
  assert(canSell('approved') && !canSell('restricted'), 'restricted vendors cannot sell');
});

test('self-shipping is Standard tier and above', () => {
  assert(!canSelfShip(0) && canSelfShip(1) && canSelfShip(2), 'tier gate');
});

test('commission is 10% of the item only, rounded to the cent', () => {
  equal(commissionCents(40000, 1000), 4000);
  equal(commissionCents(12345, 1000), 1235); // 1234.5 rounds up
  equal(commissionCents(0, 1000), 0);
});

test('Lane C delivery fee splits 80/20 in whole cents and adds back exactly', () => {
  const s = splitLaneCDelivery(7900);
  equal(s.vendor, 6320); equal(s.platform, 1580);
  const odd = splitLaneCDelivery(7999);
  equal(odd.vendor + odd.platform, 7999);
});

test('payout: commission, delivery service fee and insurance come off, then 2% is held', () => {
  const p = payoutBreakdown({ itemCents: 100000, deliveryServiceCents: 5900, insuranceCents: 1500 });
  equal(p.commission, 10000);
  equal(p.netBeforeReserve, 100000 - 10000 - 5900 - 1500); // 82600
  equal(p.reserve, 1652);                                   // 2% of 82600
  equal(p.hstOnFeesCents, 2067);                            // 13% of commission + delivery service (insurance is exempt)
  equal(p.payable, 82600 - 1652 - 2067);
});

test('payout: Lane C adds the vendor\'s delivery share and charges no service fee', () => {
  const share = splitLaneCDelivery(7900).vendor;
  const p = payoutBreakdown({ itemCents: 50000, laneCDeliveryCents: share });
  equal(p.netBeforeReserve, 50000 + share - 5000);
});

test('a loss-making order never produces a negative reserve', () => {
  const p = payoutBreakdown({ itemCents: 1000, deliveryServiceCents: 9000 });
  equal(p.reserve, 0);
});

test('every unit needs the full year', () => {
  assert(warrantyOk(12) && warrantyOk(24) && !warrantyOk(11) && !warrantyOk(0) && !warrantyOk(undefined), 'warranty floor');
});

test('strikes resurface for review after 90 days, never once revised', () => {
  const issued = new Date('2026-07-01T00:00:00Z');
  assert(!strikeDueForReview({ lastReviewAt: issued, revisedAt: null }, new Date('2026-09-20T00:00:00Z')), 'not yet');
  assert(strikeDueForReview({ lastReviewAt: issued, revisedAt: null }, new Date('2026-10-10T00:00:00Z')), 'due');
  assert(!strikeDueForReview({ lastReviewAt: issued, revisedAt: new Date() }, new Date('2027-01-01T00:00:00Z')), 'revised');
});

test('dollars to cents is exact', () => { equal(toCents(1061.95), 106195); });

suite('vendors — access, commission and strikes against a real database');

const apply = (name, mail) => createApplication({
  legalName: name, contactEmail: mail, hstStatus: 'registered', sourceOfGoods: 'dealer overstock'
});

test('slugs are tidy and unique', async () => {
  const { client, done } = await withTestDb();
  try {
    equal(slugify('Abi & Sons Appliances Ltd.'), 'abi-and-sons-appliances-ltd');
    const a = await apply('Abi Appliances', 'abi@example.com');
    const b = await apply('Abi Appliances', 'abi2@example.com');
    equal(a.slug, 'abi-appliances'); equal(b.slug, 'abi-appliances-2');
  } finally { done(); }
});

test('an applicant has no portal; approval needs an HST position and a name', async () => {
  const { done } = await withTestDb();
  try {
    const v = await createApplication({ legalName: 'NoHst Inc', contactEmail: 'n@example.com' });
    await grantVendorUser(v.id, { email: 'n@example.com', role: 'owner', by: 'staff@bb.ca' });
    equal(await vendorAccess('n@example.com'), null);                 // still applied
    await rejects(() => decideApplication(v.id, { approve: true, by: 'staff@bb.ca' }), /HST/);
    await rejects(() => decideApplication(v.id, { approve: true }), /Who/);
    await decideApplication(v.id, { approve: true, by: 'staff@bb.ca', hstStatus: 'small_supplier' });
    const acc = await vendorAccess('N@Example.com');                  // case-insensitive
    equal(acc.status, 'approved'); equal(acc.tier, 0); equal(acc.role, 'owner');
  } finally { done(); }
});

test('rejecting needs a reason, and a rejected vendor can never be given access', async () => {
  const { done } = await withTestDb();
  try {
    const v = await apply('Nope Ltd', 'nope@example.com');
    await rejects(() => decideApplication(v.id, { approve: false, by: 's' }), /reason/);
    await decideApplication(v.id, { approve: false, by: 's', reason: 'identity unverifiable' });
    await rejects(() => grantVendorUser(v.id, { email: 'x@example.com', by: 's' }), /rejected/);
  } finally { done(); }
});

test('TENANT ISOLATION: an email resolves to its own vendor only, and one email cannot serve two', async () => {
  const { done } = await withTestDb();
  try {
    const a = await apply('Alpha', 'a@example.com');
    const b = await apply('Bravo', 'b@example.com');
    for (const v of [a, b]) await decideApplication(v.id, { approve: true, by: 's' });
    await grantVendorUser(a.id, { email: 'a-user@example.com', by: 's' });
    await grantVendorUser(b.id, { email: 'b-user@example.com', by: 's' });
    equal((await vendorAccess('a-user@example.com')).id, a.id);
    equal((await vendorAccess('b-user@example.com')).id, b.id);
    equal(await vendorAccess('stranger@example.com'), null);
    await rejects(() => grantVendorUser(b.id, { email: 'a-user@example.com', by: 's' }), /different vendor/);
  } finally { done(); }
});

test('revoking removes access but keeps the row, and the email can be granted again', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await apply('Charlie', 'c@example.com');
    await decideApplication(v.id, { approve: true, by: 's' });
    await grantVendorUser(v.id, { email: 'u@example.com', by: 's' });
    await revokeVendorUser(v.id, 'u@example.com', { by: 'boss' });
    equal(await vendorAccess('u@example.com'), null);
    const { rows } = await client.query('SELECT revoked_by FROM vendor_users WHERE email = $1', ['u@example.com']);
    equal(rows.length, 1); equal(rows[0].revoked_by, 'boss');
    await grantVendorUser(v.id, { email: 'u@example.com', by: 's' });
    assert(await vendorAccess('u@example.com'), 're-granted');
  } finally { done(); }
});

test('commission is 10% by default, and a raise starts on its date without touching history', async () => {
  const { done } = await withTestDb();
  try {
    const v = await apply('Delta', 'd@example.com');
    await decideApplication(v.id, { approve: true, by: 's' });
    equal(await commissionBpsFor(v.id, '2026-10-10'), 1000);
    await rejects(() => setCommission({ vendorId: v.id, rateBps: 1200, effectiveFrom: '2020-01-01', by: 'boss' }), /past/);
    await setCommission({ vendorId: v.id, rateBps: 1200, effectiveFrom: '2099-01-01', by: 'boss' });
    equal(await commissionBpsFor(v.id, '2026-10-10'), 1000);
    equal(await commissionBpsFor(v.id, '2099-02-01'), 1200);
    await rejects(() => setCommission({ rateBps: 9000, by: 'boss' }), /50%/);
  } finally { done(); }
});

test('three active strikes restrict the vendor; revising one does NOT reinstate them', async () => {
  const { done } = await withTestDb();
  try {
    const v = await apply('Echo', 'e@example.com');
    await decideApplication(v.id, { approve: true, by: 's' });
    await grantVendorUser(v.id, { email: 'e-user@example.com', by: 's' });
    await rejects(() => issueStrike(v.id, { reason: 'bogus', by: 's' }), /reason/);
    await rejects(() => issueStrike(v.id, { reason: 'other', by: 's' }), /explanation/);
    const s1 = await issueStrike(v.id, { reason: 'missed_accept', orderRef: 'BB-1', by: 'system' });
    equal(s1.active, 1); equal(s1.restricted, false);
    await issueStrike(v.id, { reason: 'cancelled_order', orderRef: 'BB-2', by: 'system' });
    equal((await strikeMeter(v.id)).standing, 'at_risk');
    const s3 = await issueStrike(v.id, { reason: 'missed_ready', orderRef: 'BB-3', by: 'system' });
    equal(s3.restricted, true);
    equal((await vendorAccess('e-user@example.com')).status, 'restricted'); // still in, to fulfil paid orders
    assert(!canSell((await vendorAccess('e-user@example.com')).status), 'but cannot sell');
    await rejects(() => reviseStrike(s3.strikeId, { by: 'boss' }), /reason/);
    await reviseStrike(s3.strikeId, { by: 'boss', reason: 'our payment confirmation was late' });
    const m = await strikeMeter(v.id);
    equal(m.active, 2);
    equal(m.strikes.length, 3);                                    // the revised strike stays on the record
    equal((await vendorAccess('e-user@example.com')).status, 'restricted');
    await rejects(() => reinstateVendor(v.id, { by: 'boss' }), /reason/);
    await reinstateVendor(v.id, { by: 'boss', reason: 'reviewed with the vendor' });
    const back = await vendorAccess('e-user@example.com');
    equal(back.status, 'approved'); equal(back.tier, 0);
  } finally { done(); }
});

test('the periodic review list surfaces old unrevised strikes and resurfaces kept ones', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await apply('Foxtrot', 'f@example.com');
    await decideApplication(v.id, { approve: true, by: 's' });
    const fresh = await issueStrike(v.id, { reason: 'missed_accept', by: 's' });
    const old = await issueStrike(v.id, { reason: 'cancelled_order', by: 's' });
    await client.query(`UPDATE vendor_strikes SET last_review_at = now() - interval '100 days' WHERE id = $1`, [old.strikeId]);
    let due = await strikesAwaitingReview();
    equal(due.length, 1); equal(due[0].id, old.strikeId);
    await markStrikeReviewed(old.strikeId, { by: 'boss' });          // keep it
    equal((await strikesAwaitingReview()).length, 0);
    await client.query(`UPDATE vendor_strikes SET last_review_at = now() - interval '100 days' WHERE id = $1`, [old.strikeId]);
    await reviseStrike(old.strikeId, { by: 'boss', reason: 'vendor resolved it' });
    equal((await strikesAwaitingReview()).length, 0);                // revised: off the list for good
    void fresh;
  } finally { done(); }
});

test('every decision leaves an event, and a revision without a reason cannot be written at all', async () => {
  const { client, done } = await withTestDb();
  try {
    const v = await apply('Golf', 'g@example.com');
    await decideApplication(v.id, { approve: true, by: 's' });
    const s = await issueStrike(v.id, { reason: 'missed_accept', by: 'system' });
    await reviseStrike(s.strikeId, { by: 'boss', reason: 'our error' });
    const { rows } = await client.query('SELECT event FROM vendor_events WHERE vendor_id = $1 ORDER BY id', [v.id]);
    equal(rows.map((r) => r.event).join(','), 'applied,approved,strike_issued,strike_revised');
    const open = await issueStrike(v.id, { reason: 'missed_ready', by: 'system' });
    let err;
    try { await client.query(`UPDATE vendor_strikes SET revised_at = now() WHERE id = $1`, [open.strikeId]); } catch (e) { err = e; }
    assert(err, 'database refuses a half-filled revision');
  } finally { done(); }
});

test('HST: the seller is handed the HST on their sale and charged HST on our fees; the pass-through is never reserved', () => {
  const p = payoutBreakdown({ itemCents: 100000, hstOnSaleCents: 13000 });
  equal(p.reserve, 1800);                                   // 2% of 90000 (item − commission), not of the HST
  equal(p.hstOnFeesCents, 1300);                            // 13% of the 10000 commission
  equal(p.payable, 100000 - 10000 - 1800 + 13000 - 1300);
});

test('the HST rate used for fees is the shop\'s HST rate', async () => {
  const { HST_RATE } = await import('../lib/constants.js');
  const { HST_BPS } = await import('../lib/marketplace-rules.js');
  equal(HST_BPS, Math.round(HST_RATE * 10000));
});
