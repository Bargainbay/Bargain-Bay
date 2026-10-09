// Warranty claims and seller deductions against a real database: the workflow, the deadlines and the
// strike-once guarantee, tenant isolation, the reserve (drawn first, blocked while a claim is open), and the
// route/permission shape.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query, withTransaction } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser, strikeMeter } from '../lib/vendors.js';
import {
  createVendorOrdersTx, confirmVendorOrders, acceptVendorOrder, markVendorOrderReady, deliverVendorOrder, sweepVendorOrders
} from '../lib/vendor-orders.js';
import { vendorBalance, vendorStatement, deduct, adjust, releaseWarrantyReserves, reserveRemaining } from '../lib/vendor-ledger.js';
import {
  openClaim, listClaims, listVendorClaims, vendorRespond, vendorResolve, staffResolve, staffNote, closeClaim, chargeClaim,
  sweepWarrantyClaims, openClaimRefs, claimsForViewer, claimState, attachClaimPhoto, claimPhotoPath, MAX_CLAIM_PHOTOS
} from '../lib/warranty-claims.js';
import { CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS } from '../lib/marketplace-rules.js';

async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw'); if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const H = 3600 * 1000;
const T0 = new Date('2026-10-20T14:00:00Z');
const plus = (h) => new Date(T0.getTime() + h * H);

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name.toLowerCase()}-user@example.com`, role: 'owner', by: 's' });
  await query('UPDATE vendors SET tier = 1 WHERE id = $1', [v.id]);
  return v;
}
let n = 0;
async function deliveredOrder(v, { price = 1000, deliveredAt = T0 } = {}) {
  n += 1; const sku = `MP-${v.id}-${String(n).padStart(4, '0')}`;
  await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, serial_private, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,'A','live','Refrigerator','Whirlpool','WRF535',$3,'Refurbished','A fridge',$4,12,60,24,24,34,true)`, [sku, v.id, `SN-${n}`, price]);
  const { rows } = await query(
    `INSERT INTO orders (email, name, phone, delivery_method, status, subtotal, hst, total)
     VALUES ('cust-private@example.com','Cust Private','416-555-0199','delivery','pending_payment',0,0,0) RETURNING id`);
  const id = rows[0].id; await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [id]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'A fridge',$3,'unit')`, [id, sku, price]);
  const unit = { id: sku, marketplace: true, lane: 'A', vendor: { id: v.id }, price, title: 'A fridge' };
  await withTransaction((c) => createVendorOrdersTx(c, { orderId: id, orderNumber: `BB-${1000 + id}`, units: [unit], deliveryMethod: 'delivery', feeCents: 7900 }));
  await confirmVendorOrders(id, { now: deliveredAt });
  const vo = (await query('SELECT * FROM vendor_orders WHERE order_id = $1', [id])).rows[0];
  await acceptVendorOrder(v.id, vo.id, { insurance: 'declined', now: deliveredAt });
  await markVendorOrderReady(v.id, vo.id, { now: deliveredAt });
  await deliverVendorOrder(vo.id, { deliveredAt });
  return { voId: vo.id, orderNumber: `BB-${1000 + id}`, sku, ref: `BB-${1000 + id}:${vo.id}` };
}
const total = async (v, now) => { const b = await vendorBalance(v.id, now || new Date(T0.getTime() + 60 * 24 * H)); return b.availableCents + b.pendingCents + b.reserveHeldCents; };

suite('warranty claims — opening and the seller\'s side');

test('a claim opens only on a DELIVERED order, inside the warranty, one open claim per unit', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o = await deliveredOrder(v);
    await rejects(() => openClaim({ vendorOrderId: o.voId, description: 'short', by: 'staff@x', now: plus(1) }), /sentence/);
    const c = await openClaim({ vendorOrderId: o.voId, description: 'It does not get cold at all', by: 'staff@x', now: plus(1) });
    assert(c.ok && c.id, 'opened');
    await rejects(() => openClaim({ vendorOrderId: o.voId, description: 'Another description here', by: 'staff@x', now: plus(2) }), /already an open claim/);
    const row = (await listClaims())[0];
    equal(new Date(row.respondBy).toISOString(), plus(1 + CLAIM_RESPOND_HOURS).toISOString());
    equal(new Date(row.resolveBy).toISOString(), plus(1 + CLAIM_RESOLVE_DAYS * 24).toISOString());
    // an undelivered order and an out-of-warranty one are refused
    const lb = await vendor('Beta'); const late = await deliveredOrder(lb, { deliveredAt: new Date('2025-01-01T00:00:00Z') });
    await rejects(() => openClaim({ vendorOrderId: late.voId, description: 'Stopped working entirely', by: 's', now: T0 }), /outside/);
    const fresh = await query(`UPDATE vendor_orders SET status = 'ready', delivered_at = NULL WHERE id = $1 RETURNING id`, [o.voId]);
    await closeClaim(c.id, { reason: 'duplicate', by: 's' });
    await rejects(() => openClaim({ vendorOrderId: fresh.rows[0].id, description: 'Stopped working entirely', by: 's', now: T0 }), /delivered/);
  } finally { done(); }
});

test('TENANT ISOLATION: a seller sees only their own claims, answers only their own, and never the customer', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const oa = await deliveredOrder(a); const ob = await deliveredOrder(b);
    const ca = await openClaim({ vendorOrderId: oa.voId, description: 'Compressor is making a loud noise', by: 'staff@x', now: plus(1) });
    await openClaim({ vendorOrderId: ob.voId, description: 'Door will not seal properly', by: 'staff@x', now: plus(1) });
    await staffNote(ca.id, { note: 'Customer Cust Private 416-555-0199 prefers mornings', internal: true, by: 'staff@x' });
    await staffNote(ca.id, { note: 'Please book a technician visit', internal: false, by: 'staff@x' });
    const mine = await listVendorClaims(a.id);
    equal(mine.length, 1); equal(mine[0].orderNumber, oa.orderNumber);
    const blob = JSON.stringify(mine);
    assert(!/cust-private|416-555|Cust Private/.test(blob), 'no customer contact, and internal notes are not shared');
    assert(/technician visit/.test(blob), 'the shared note is');
    await rejects(() => vendorRespond(b.id, ca.id, { note: 'I will fix it', by: 'x' }), /not found/);   // Beta cannot touch Alpha's claim
    await rejects(() => vendorResolve(b.id, ca.id, { resolution: 'repair', note: 'done and dusted', by: 'x' }), /not found/);
  } finally { done(); }
});

test('respond and resolve: repair/replace closes it; refund waits for us, but the seller\'s deadline is met', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o1 = await deliveredOrder(v); const o2 = await deliveredOrder(v);
    const c1 = await openClaim({ vendorOrderId: o1.voId, description: 'Does not get cold enough at all', by: 's', now: T0 });
    const c2 = await openClaim({ vendorOrderId: o2.voId, description: 'Ice maker leaks onto the floor', by: 's', now: T0 });
    await rejects(() => vendorRespond(v.id, c1.id, { note: 'ok', by: 'u' }), /what you will do/);
    await vendorRespond(v.id, c1.id, { note: 'Technician booked for Friday', by: 'u', now: plus(5) });
    equal((await listClaims()).find((c) => c.id === c1.id).status, 'responded');
    await vendorResolve(v.id, c1.id, { resolution: 'repair', note: 'Replaced the thermostat', by: 'u', now: plus(60) });
    equal((await listClaims()).find((c) => c.id === c1.id).status, 'resolved');
    const r = await vendorResolve(v.id, c2.id, { resolution: 'refund', note: 'Refund the customer, I accept', by: 'u', now: plus(60) });
    assert(r.awaitingRefund, 'waits for us');
    const row = (await listClaims()).find((c) => c.id === c2.id);
    equal(row.status, 'awaiting_refund'); assert(row.vendorDoneAt, 'seller is done');
    equal(claimState({ ...row }, plus(24 * 30)).overdue, false);                  // a seller who agreed is never "overdue"
    await rejects(() => vendorRespond(v.id, c1.id, { note: 'one more thing here', by: 'u' }), /resolved/);
  } finally { done(); }
});

suite('warranty claims — deadlines, reminders and the strike (once)');

test('an unanswered claim is struck once after 48h; a later missed resolution adds no second strike', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o = await deliveredOrder(v);
    const c = await openClaim({ vendorOrderId: o.voId, description: 'Does not get cold enough at all', by: 's', now: T0 });
    let r = await sweepWarrantyClaims({ now: plus(25) });
    equal(r.reminded, 1); equal(r.struck, 0);
    r = await sweepWarrantyClaims({ now: plus(25) });
    equal(r.reminded, 0);                                                         // a reminder goes once
    r = await sweepWarrantyClaims({ now: plus(49) });
    equal(r.struck, 1); equal((await strikeMeter(v.id)).active, 1);
    r = await sweepWarrantyClaims({ now: plus(50) }); equal(r.struck, 0);
    r = await sweepWarrantyClaims({ now: plus(24 * 8) });                         // past the 7-day resolve deadline too
    equal(r.struck, 0); equal((await strikeMeter(v.id)).active, 1);              // ONE strike per claim
    const row = (await listClaims()).find((x) => x.id === c.id); assert(row.struck && row.strikeId, 'recorded on the claim');
    equal((await strikeMeter(v.id)).strikes[0].reason_code, 'warranty_response');
  } finally { done(); }
});

test('answered in time but not resolved in 7 days is struck; an answered-and-resolved claim is never struck; a closed one neither', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o1 = await deliveredOrder(v); const o2 = await deliveredOrder(v); const o3 = await deliveredOrder(v);
    const c1 = await openClaim({ vendorOrderId: o1.voId, description: 'Does not get cold enough at all', by: 's', now: T0 });
    const c2 = await openClaim({ vendorOrderId: o2.voId, description: 'Ice maker leaks onto the floor', by: 's', now: T0 });
    const c3 = await openClaim({ vendorOrderId: o3.voId, description: 'Light does not come on at all', by: 's', now: T0 });
    await vendorRespond(v.id, c1.id, { note: 'Technician booked', by: 'u', now: plus(2) });
    await vendorRespond(v.id, c2.id, { note: 'Fixing it', by: 'u', now: plus(2) });
    await vendorResolve(v.id, c2.id, { resolution: 'replace', note: 'Sent a replacement', by: 'u', now: plus(30) });
    await closeClaim(c3.id, { reason: 'customer withdrew it', by: 's' });
    let r = await sweepWarrantyClaims({ now: plus(24 * 5 + 1) });
    equal(r.struck, 0); equal(r.reminded, 1);                                    // c1's day-5 resolve reminder only
    r = await sweepWarrantyClaims({ now: plus(24 * 7 + 1) });
    equal(r.struck, 1);
    const rows = await listClaims();
    assert(rows.find((c) => c.id === c1.id).struck, 'c1 struck');
    assert(!rows.find((c) => c.id === c2.id).struck && !rows.find((c) => c.id === c3.id).struck, 'c2 and c3 not');
  } finally { done(); }
});

suite('warranty claims — money: the reserve first, once, and the release block');

test('a paid claim comes from THAT order\'s reserve first, then the balance, exactly once', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o = await deliveredOrder(v);   // item $1,000: reserve held ~ 2% of the net
    const reserve0 = await reserveRemaining(query, v.id, o.ref);
    assert(reserve0 > 1000 && reserve0 < 3000, `reserve held ${reserve0}`);
    const before = await total(v);
    const c = await openClaim({ vendorOrderId: o.voId, description: 'Does not get cold enough at all', by: 's', now: plus(1) });
    await rejects(() => chargeClaim(c.id, { amountCents: 0, by: 'admin' }), /amount/);
    const r = await chargeClaim(c.id, { amountCents: 20000, by: 'admin@x', note: 'new compressor' });
    equal(r.drawnFromReserveCents, reserve0); equal(r.fromBalanceCents, 20000 - reserve0);
    equal(await reserveRemaining(query, v.id, o.ref), 0);
    equal(before - (await total(v)), 20000);                                     // the seller is out exactly the claim
    await rejects(() => chargeClaim(c.id, { amountCents: 20000, by: 'admin@x' }), /already/);   // not twice
    equal(before - (await total(v)), 20000);
    const kinds = (await vendorStatement(v.id)).map((e) => e.kind);
    assert(kinds.includes('guarantee_claim') && kinds.includes('warranty_release'), kinds.join());
    // staff browsers get no cost figures
    const staffView = claimsForViewer(await listClaims(), false)[0];
    assert(!('costCents' in staffView) && staffView.charged === true, 'costs stripped for staff');
    equal(claimsForViewer(await listClaims(), true)[0].costCents, 20000);
  } finally { done(); }
});

test('a small claim leaves the rest of the reserve in place; a charge-back is the other kind', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o = await deliveredOrder(v);
    const reserve0 = await reserveRemaining(query, v.id, o.ref);
    const c = await openClaim({ vendorOrderId: o.voId, description: 'Does not get cold enough at all', by: 's', now: plus(1) });
    const r = await chargeClaim(c.id, { amountCents: 500, kind: 'chargeback', by: 'admin' });
    equal(r.drawnFromReserveCents, 500); equal(await reserveRemaining(query, v.id, o.ref), reserve0 - 500);
    await rejects(() => chargeClaim(c.id, { amountCents: 500, kind: 'refund', by: 'admin' }), /already|Choose/);
  } finally { done(); }
});

test('RESERVE RELEASE: blocked while a claim is open, partial draws are not released twice, and the sweep wires it up', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha');
    const old = await deliveredOrder(v, { deliveredAt: new Date('2025-06-01T00:00:00Z') });
    const c = await openClaim({ vendorOrderId: old.voId, description: 'Does not get cold enough at all', by: 's', now: new Date('2026-10-01T00:00:00Z') }).catch(() => null);
    assert(c === null, 'out of warranty: cannot open (13 months on)');
    // an open claim is what blocks: insert one directly for an in-warranty order, then age the reserve
    const fresh = await deliveredOrder(v, { deliveredAt: plus(0) });
    await openClaim({ vendorOrderId: fresh.voId, description: 'Does not get cold enough at all', by: 's', now: plus(1) });
    const refs = await openClaimRefs();
    assert(refs.has(fresh.ref) && !refs.has(old.ref), 'only the claimed order is blocked');
    const later = new Date(plus(0).getTime() + 400 * 24 * H);
    const r = await releaseWarrantyReserves({ now: later, blocked: refs });
    equal(r.released, 1);                                                         // the old order's reserve; the claimed one stays
    assert(await reserveRemaining(query, v.id, fresh.ref) > 0, 'claimed reserve still held');
    equal(await reserveRemaining(query, v.id, old.ref), 0);
    // sweepVendorOrders releases through the same block
    const s = await sweepVendorOrders({ now: later });
    equal(s.reserveReleased, 0);
    // close the claim: now it can go
    await closeClaim((await listClaims())[0].id, { reason: 'fixed', by: 's' });
    equal((await sweepVendorOrders({ now: later })).reserveReleased, 1);
    equal(await reserveRemaining(query, v.id, fresh.ref), 0);
  } finally { done(); }
});

test('a partial draw is not released a second time', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const o = await deliveredOrder(v, { deliveredAt: new Date('2025-01-01T00:00:00Z') });
    const held = await reserveRemaining(query, v.id, o.ref);
    await deduct(v.id, { kind: 'guarantee_claim', amountCents: 500, orderRef: o.ref, memo: 'x', by: 'a', idemKey: 'k1', drawReserve: true });
    equal(await reserveRemaining(query, v.id, o.ref), held - 500);
    const before = await total(v, new Date('2027-06-01T00:00:00Z'));
    equal((await releaseWarrantyReserves({ now: new Date('2027-06-01T00:00:00Z') })).released, 1);
    equal(await reserveRemaining(query, v.id, o.ref), 0);
    equal(await total(v, new Date('2027-06-01T00:00:00Z')), before);               // releasing moves it between parts, never out
    equal((await releaseWarrantyReserves({ now: new Date('2027-06-01T00:00:00Z') })).released, 0);
  } finally { done(); }
});

test('deductions are idempotent per key; an adjustment needs a reason; the sign rules hold', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); await deliveredOrder(v);
    const a = await deduct(v.id, { kind: 'refund', amountCents: 1500, memo: 'r', by: 'a', idemKey: 'dup' });
    const b = await deduct(v.id, { kind: 'refund', amountCents: 1500, memo: 'r', by: 'a', idemKey: 'dup' });
    assert(!a.duplicate && b.duplicate, 'second is a duplicate');
    await rejects(() => deduct(v.id, { kind: 'adjustment', amountCents: 5, by: 'a', idemKey: 'z' }), /Not a deduction/);
    await rejects(() => deduct(v.id, { kind: 'refund', amountCents: 5, by: 'a' }), /idempotency/);
    await rejects(() => adjust(v.id, { amountCents: 500, by: 'admin' }), /reason/);
    const t0 = await total(v);
    await adjust(v.id, { amountCents: 700, memo: 'goodwill', by: 'admin', idemKey: 'adj1' });
    await adjust(v.id, { amountCents: 700, memo: 'goodwill', by: 'admin', idemKey: 'adj1' });
    equal(await total(v) - t0, 700);
  } finally { done(); }
});

suite('warranty claims — photos');

test('photos on a claim: staff add the fault, the seller adds the repair, each sees both, nobody sees another seller\'s', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const oa = await deliveredOrder(a); const ob = await deliveredOrder(b);
    const ca = await openClaim({ vendorOrderId: oa.voId, description: 'Compressor is making a loud noise', by: 'staff@x', now: plus(1) });
    const cb = await openClaim({ vendorOrderId: ob.voId, description: 'Door will not seal properly', by: 'staff@x', now: plus(1) });
    const s1 = await attachClaimPhoto(ca.id, { by: 'staff@x', blobPath: 'claims/1/a.jpg', caption: 'the fault' });
    const v1 = await attachClaimPhoto(ca.id, { vendorId: a.id, by: 'alpha-user@example.com', blobPath: 'claims/1/b.jpg' });
    const mine = (await listVendorClaims(a.id))[0];
    equal(mine.photos.map((p) => p.side).join(), 'staff,vendor');
    equal((await listClaims()).find((c) => c.id === ca.id).photos.length, 2);
    assert(!/claims\/1/.test(JSON.stringify(mine)), 'the storage path is never sent to a browser');
    equal(await claimPhotoPath(s1.id, { vendorId: a.id }), 'claims/1/a.jpg');
    equal(await claimPhotoPath(s1.id, { vendorId: b.id }), null);                  // another seller's photo is just not there
    equal(await claimPhotoPath(v1.id), 'claims/1/b.jpg');                          // staff see any
    await rejects(() => attachClaimPhoto(ca.id, { vendorId: b.id, by: 'beta', blobPath: 'x.jpg' }), /not found/);
    equal((await listVendorClaims(b.id))[0].photos.length, 0); void cb;
    for (let i = 2; i < MAX_CLAIM_PHOTOS; i++) await attachClaimPhoto(ca.id, { by: 's', blobPath: `claims/1/${i}.jpg` });
    await rejects(() => attachClaimPhoto(ca.id, { by: 's', blobPath: 'one-too-many.jpg' }), /at most/);
    await closeClaim(ca.id, { reason: 'withdrawn', by: 's' });
    await rejects(() => attachClaimPhoto(ca.id, { vendorId: a.id, by: 'alpha', blobPath: 'late.jpg' }), /closed|at most/);
  } finally { done(); }
});

suite('warranty claims — who may do what');

test('routes: the seller\'s route turns away everyone else; the cost figures and the charge are admin-only', async () => {
  const { readFileSync } = await import('node:fs');
  const claims = readFileSync(new URL('../app/api/admin/marketplace/claims/route.js', import.meta.url), 'utf8');
  assert(/case 'charge':\s*\n\s*if \(!isAdmin\(s\)\) return denied\(\)/.test(claims), 'charge is admin');
  assert(/claimsForViewer\(claims, isAdmin\(s\)\)/.test(claims), 'staff get the stripped list');
  const ledger = readFileSync(new URL('../app/api/admin/marketplace/ledger/route.js', import.meta.url), 'utf8');
  assert((ledger.match(/!isAdmin\(s\)\) return denied/g) || []).length === 2, 'both methods are admin');
  const vend = readFileSync(new URL('../app/api/vendor/claims/route.js', import.meta.url), 'utf8');
  assert(/requireVendor/.test(vend) && !/vendorId/.test(vend.replace(/ctx\.vendor\.id/g, '')), 'the vendor id comes from the session');
});
