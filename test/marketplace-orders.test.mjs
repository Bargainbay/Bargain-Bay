// The checkout split: vendor orders, the payment-confirmed clocks, accept / ready / cancel, the sweep,
// and settlement to the vendor's ledger — against a real database.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query, withTransaction } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser, strikeMeter } from '../lib/vendors.js';
import {
  sizeClassFor, insuranceCents, shipmentCount, notPickable, planVendorOrders, trackingLooksValid, payoutBreakdown
} from '../lib/marketplace-rules.js';
import {
  createVendorOrdersTx, confirmVendorOrders, acceptVendorOrder, markVendorOrderReady, cancelVendorOrder,
  sweepVendorOrders, deliverVendorOrder, onOrderStatus, listVendorOrders, allVendorOrders,
  setDeliveryRate, deliveryRates
} from '../lib/vendor-orders.js';
import { vendorBalance, vendorStatement } from '../lib/vendor-ledger.js';
import { markUnitsSold } from '../lib/catalog-sync.js';
import { getMany } from '../lib/inventory.js';

async function rejects(fn, re) {
  let err;
  try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const H = 3600 * 1000;
const T0 = new Date('2026-10-20T14:00:00Z');
const plus = (h) => new Date(T0.getTime() + h * H);

// ---------------------------------------------------------------------------
suite('marketplace order rules — shipments, pickup and sizes (pure)');

test('size classes, insurance and tracking', () => {
  equal(sizeClassFor({ weightLb: 60, widthIn: 24, depthIn: 24, heightIn: 34 }), 'small');
  equal(sizeClassFor({ weightLb: 150, widthIn: 30, depthIn: 28, heightIn: 36 }), 'standard');
  equal(sizeClassFor({ weightLb: 280, widthIn: 36, depthIn: 34, heightIn: 70 }), 'oversize');
  equal(sizeClassFor({ weightLb: 100, widthIn: 30, depthIn: 30, heightIn: 80 }), 'oversize');   // tall counts
  equal(insuranceCents(100000), 1500);
  assert(trackingLooksValid('1Z999AA10123456784') && !trackingLooksValid('123') && !trackingLooksValid(''), 'tracking');
});

test('everything WE move is one shipment; each self-shipping seller is another', () => {
  const own = { id: 'S-1' }; const a = { marketplace: true, lane: 'A', vendor: { id: 1 } };
  const b = { marketplace: true, lane: 'B', vendor: { id: 2 } };
  const c1 = { marketplace: true, lane: 'C', vendor: { id: 3 } }; const c2 = { marketplace: true, lane: 'C', vendor: { id: 4 } };
  equal(shipmentCount([own]), 1); equal(shipmentCount([own, a, b]), 1);
  equal(shipmentCount([c1]), 1); equal(shipmentCount([own, c1]), 2); equal(shipmentCount([own, a, c1, c2, c1]), 3);
});

test('Lane B and C units cannot be warehouse pickups; Lane A can', () => {
  assert(!notPickable({ id: 'S' }) && !notPickable({ marketplace: true, lane: 'A' }), 'own and Lane A are pickable');
  assert(notPickable({ marketplace: true, lane: 'B' }) && notPickable({ marketplace: true, lane: 'C' }), 'B and C are not');
  const u = (lane, id) => ({ id: `MP-${id}-1`, marketplace: true, lane, vendor: { id }, price: 500, title: 'x' });
  equal(planVendorOrders([u('C', 1)], { deliveryMethod: 'pickup' }).errors.length, 1);
  equal(planVendorOrders([u('A', 1)], { deliveryMethod: 'pickup' }).errors.length, 0);
});

test('the plan groups by vendor and lane, in cents, and gives a Lane C seller 80% of the delivery fee', () => {
  const u = (id, lane, vid, price) => ({ id, marketplace: true, lane, vendor: { id: vid }, price });
  const p = planVendorOrders([u('a', 'A', 1, 400), u('b', 'A', 1, 600.5), u('c', 'C', 1, 300), u('d', 'C', 2, 100)], { deliveryMethod: 'delivery', feeCents: 7900 });
  equal(p.groups.length, 3);
  const g = (v, l) => p.groups.find((x) => x.vendorId === v && x.lane === l);
  equal(g(1, 'A').itemCents, 100050); equal(g(1, 'A').laneCDeliveryCents, 0);
  equal(g(1, 'C').laneCDeliveryCents, 6320); equal(g(2, 'C').itemCents, 10000);
  equal(planVendorOrders([u('c', 'C', 1, 300)], { deliveryMethod: 'pickup', feeCents: 7900 }).groups[0].laneCDeliveryCents, 0);
});

// ---------------------------------------------------------------------------
suite('vendor orders — the lifecycle against a real database');

async function vendor(name, { tier = 1 } = {}) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name.toLowerCase()}-user@example.com`, role: 'owner', by: 's' });
  await query('UPDATE vendors SET tier = $2 WHERE id = $1', [v.id, tier]);
  return v;
}
let n = 0;
async function listing(vendorId, lane = 'A', price = 1000, over = {}) {
  n += 1;
  const sku = `MP-${vendorId}-${String(n).padStart(4, '0')}`;
  const { rows } = await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,$3,'live','Refrigerator','Whirlpool','WRF535','Refurbished','A fridge',$4,12,$5,36,34,70,true) RETURNING id`,
    [sku, vendorId, lane, price, over.weight ?? 280]);
  return { id: rows[0].id, sku };
}
const unit = (l, vendorRow, lane, price) => ({ id: l.sku, marketplace: true, lane, vendor: { id: vendorRow.id }, price, title: 'A fridge' });

async function order(units, { deliveryMethod = 'delivery', createdAt } = {}) {
  const { rows } = await query(
    `INSERT INTO orders (email, name, delivery_method, status, subtotal, hst, total, created_at)
     VALUES ('c@example.com','Cust',$1,'pending_payment',0,0,0,COALESCE($2::timestamptz, now())) RETURNING id`, [deliveryMethod, createdAt || null]);
  const id = rows[0].id;
  await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [id]);
  for (const u of units) await query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'A fridge',$3,'unit')`, [id, u.id, u.price]);
  await withTransaction((c) => createVendorOrdersTx(c, { orderId: id, orderNumber: `BB-${1000 + id}`, units, deliveryMethod, feeCents: 7900 }));
  return { id, number: `BB-${1000 + id}` };
}
const vo = async (orderId, lane) => (await query('SELECT * FROM vendor_orders WHERE order_id = $1 AND lane = $2', [orderId, lane])).rows[0];

test('checkout writes one vendor order per vendor and lane, stamps the lines, and refuses a unit that came off sale', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l1 = await listing(a.id, 'A'); const l2 = await listing(a.id, 'C');
    const o = await order([unit(l1, a, 'A', 1000), unit(l2, a, 'C', 500)]);
    equal((await query('SELECT count(*)::int AS n FROM vendor_orders WHERE order_id = $1', [o.id])).rows[0].n, 2);
    equal((await query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND vendor_id = $2 AND listing_id IS NOT NULL', [o.id, a.id])).rows[0].n, 2);
    equal(Number((await vo(o.id, 'C')).lane_c_delivery_cents), 6320);
    await query(`UPDATE marketplace_listings SET status = 'paused' WHERE id = $1`, [l1.id]);
    let err;
    try { await withTransaction((c) => createVendorOrdersTx(c, { orderId: 999, orderNumber: 'BB-X', units: [unit(l1, a, 'A', 1000)], deliveryMethod: 'delivery', feeCents: 7900 })); } catch (e) { err = e; }
    assert(err && err.code === 'SKU_HELD', 'a paused unit cannot be bought');
    let err2;
    try { await withTransaction((c) => createVendorOrdersTx(c, { orderId: 998, orderNumber: 'BB-Y', units: [unit(l2, a, 'C', 500)], deliveryMethod: 'pickup', feeCents: 7900 })); } catch (e) { err2 = e; }
    assert(err2 && err2.code === 'NOT_PICKABLE', 'Lane C needs delivery');
  } finally { done(); }
});

test('the vendor hears nothing before payment: no clocks, no order on their list', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    equal((await listVendorOrders(a.id)).length, 0);
    const row = await vo(o.id, 'A');
    equal(row.status, 'awaiting_payment'); equal(row.accept_by, null);
    equal((await query('SELECT status FROM marketplace_listings WHERE id = $1', [l.id])).rows[0].status, 'live');
  } finally { done(); }
});

test('CONFIRMING PAYMENT STARTS BOTH CLOCKS: 24h to accept, 72h in total, units sold, idempotent', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    equal((await confirmVendorOrders(o.id, { now: T0 })).confirmed, 1);
    const row = await vo(o.id, 'A');
    equal(row.status, 'awaiting_accept');
    equal(new Date(row.accept_by).toISOString(), plus(24).toISOString());
    equal(new Date(row.ready_by).toISOString(), plus(72).toISOString());
    equal((await query('SELECT status FROM marketplace_listings WHERE id = $1', [l.id])).rows[0].status, 'sold');
    equal((await confirmVendorOrders(o.id, { now: plus(5) })).confirmed, 0);                       // a second confirm moves nothing
    equal(new Date((await vo(o.id, 'A')).accept_by).toISOString(), plus(24).toISOString());
    equal((await listVendorOrders(a.id)).length, 1);
  } finally { done(); }
});

test('the order hook: confirmed starts the clocks, and it never throws', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    await onOrderStatus(o.id, 'confirmed');
    equal((await vo(o.id, 'A')).status, 'awaiting_accept');
    await onOrderStatus(424242, 'confirmed');                      // an order with no vendor lines
    await onOrderStatus(o.id, 'nonsense');
  } finally { done(); }
});

test('ACCEPT: Lanes A/B must choose insurance (no default); the choice and the fees are recorded', async () => {
  const { done } = await withTestDb();
  try {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    const a = await vendor('Alpha'); const l = await listing(a.id, 'A', 1000); const o = await order([unit(l, a, 'A', 1000)]);
    await confirmVendorOrders(o.id, { now: T0 });
    const id = (await vo(o.id, 'A')).id;
    await rejects(() => acceptVendorOrder(a.id, id, { now: plus(2) }), /insure/);
    await rejects(() => acceptVendorOrder(a.id, id, { insurance: 'maybe', now: plus(2) }), /insure/);
    await acceptVendorOrder(a.id, id, { insurance: 'insured', by: 'u', now: plus(2) });
    const r = await vo(o.id, 'A');
    equal(r.status, 'accepted'); equal(r.insurance_choice, 'insured'); equal(Number(r.insurance_cents), 1500); equal(Number(r.delivery_service_cents), 8900);
    await rejects(() => acceptVendorOrder(a.id, id, { insurance: 'insured', now: plus(3) }), /accepted/);
  } finally { done(); }
});

test('declining insurance costs nothing and is recorded; Lane C is never asked', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id, 'A'); const c = await listing(a.id, 'C');
    const o = await order([unit(l, a, 'A', 1000), unit(c, a, 'C', 500)]); await confirmVendorOrders(o.id, { now: T0 });
    await acceptVendorOrder(a.id, (await vo(o.id, 'A')).id, { insurance: 'declined', now: plus(1) });
    equal((await vo(o.id, 'A')).insurance_choice, 'declined'); equal(Number((await vo(o.id, 'A')).insurance_cents), 0);
    await acceptVendorOrder(a.id, (await vo(o.id, 'C')).id, { now: plus(1) });
    equal((await vo(o.id, 'C')).insurance_choice, null); equal(Number((await vo(o.id, 'C')).delivery_service_cents), 0);
  } finally { done(); }
});

test('TENANT ISOLATION: another vendor cannot accept, ready, cancel or even see this order', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    await confirmVendorOrders(o.id, { now: T0 }); const id = (await vo(o.id, 'A')).id;
    await rejects(() => acceptVendorOrder(b.id, id, { insurance: 'insured', now: plus(1) }), /not found/i);
    await rejects(() => markVendorOrderReady(b.id, id, {}), /not found/i);
    await rejects(() => cancelVendorOrder(b.id, id, { reasonCode: 'out_of_stock' }), /not found/i);
    equal((await listVendorOrders(b.id)).length, 0);
  } finally { done(); }
});

test('accepting after the 24 hours is refused: the order is cancelled and the seller struck', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    await confirmVendorOrders(o.id, { now: T0 }); const id = (await vo(o.id, 'A')).id;
    await rejects(() => acceptVendorOrder(a.id, id, { insurance: 'insured', now: plus(25) }), /24 hours/);
    const r = await vo(o.id, 'A');
    equal(r.status, 'cancelled'); equal(r.cancel_code, 'accept_timeout');
    equal((await strikeMeter(a.id)).strikes[0].reason_code, 'missed_accept');
  } finally { done(); }
});

test('READY: Lane C needs a carrier and a real-looking tracking number; Lane A just needs to be ready', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id, 'A'); const c = await listing(a.id, 'C');
    const o = await order([unit(l, a, 'A', 1000), unit(c, a, 'C', 500)]); await confirmVendorOrders(o.id, { now: T0 });
    const ida = (await vo(o.id, 'A')).id; const idc = (await vo(o.id, 'C')).id;
    await rejects(() => markVendorOrderReady(a.id, ida, { now: plus(2) }), /Accept the order first/);
    await acceptVendorOrder(a.id, ida, { insurance: 'declined', now: plus(1) }); await acceptVendorOrder(a.id, idc, { now: plus(1) });
    await markVendorOrderReady(a.id, ida, { now: plus(30) });
    equal((await vo(o.id, 'A')).status, 'ready');
    await rejects(() => markVendorOrderReady(a.id, idc, { now: plus(30) }), /carrier/);
    await rejects(() => markVendorOrderReady(a.id, idc, { carrier: 'Purolator', trackingNumber: '12', now: plus(30) }), /tracking/);
    await markVendorOrderReady(a.id, idc, { carrier: 'Purolator', trackingNumber: '1Z999AA10123456784', now: plus(30) });
    equal((await vo(o.id, 'C')).tracking_number, '1Z999AA10123456784');
    equal((await strikeMeter(a.id)).active, 0);
  } finally { done(); }
});

test('CANCEL: a reason from the list, a strike every time, the unit comes off sale, the customer is flagged for refund', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]);
    await confirmVendorOrders(o.id, { now: T0 }); const id = (await vo(o.id, 'A')).id;
    await rejects(() => cancelVendorOrder(a.id, id, { reasonCode: 'because' }), /reason/);
    await rejects(() => cancelVendorOrder(a.id, id, { reasonCode: 'other' }), /explanation/);
    await cancelVendorOrder(a.id, id, { reasonCode: 'out_of_stock', by: 'u', now: plus(3) });
    equal((await vo(o.id, 'A')).status, 'cancelled');
    equal((await strikeMeter(a.id)).strikes[0].reason_code, 'cancelled_order');
    equal((await query('SELECT status FROM marketplace_listings WHERE id = $1', [l.id])).rows[0].status, 'withdrawn');
    await rejects(() => cancelVendorOrder(a.id, id, { reasonCode: 'out_of_stock' }), /cancelled/);
  } finally { done(); }
});

test('three cancellations restrict the seller and take what is left on sale down', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const stay = await listing(a.id);
    for (let i = 0; i < 3; i++) {
      const l = await listing(a.id); const o = await order([unit(l, a, 'A', 1000)]); await confirmVendorOrders(o.id, { now: T0 });
      await cancelVendorOrder(a.id, (await vo(o.id, 'A')).id, { reasonCode: 'out_of_stock', now: plus(1) });
    }
    equal((await query('SELECT status FROM vendors WHERE id = $1', [a.id])).rows[0].status, 'restricted');
    equal((await query('SELECT status FROM marketplace_listings WHERE id = $1', [stay.id])).rows[0].status, 'paused');
  } finally { done(); }
});

test('THE SWEEP: lapses at 24h, strikes at 72h exactly once, reminds once, and closes unpaid orders', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const l1 = await listing(a.id); const o1 = await order([unit(l1, a, 'A', 1000)]); await confirmVendorOrders(o1.id, { now: T0 });      // never accepted
    const l2 = await listing(a.id); const o2 = await order([unit(l2, a, 'A', 1000)]); await confirmVendorOrders(o2.id, { now: T0 });
    await acceptVendorOrder(a.id, (await vo(o2.id, 'A')).id, { insurance: 'declined', now: plus(1) });                                       // accepted, never ready
    const l3 = await listing(a.id); const o3 = await order([unit(l3, a, 'A', 1000)]);
    await query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [o3.id]);                                                              // customer never paid

    let r = await sweepVendorOrders({ now: plus(13) });
    equal(r.reminded, 1); equal(r.lapsed, 0); equal(r.closed, 1);                                                      // the 12h accept reminder goes to o1 only — o2 was already accepted
    r = await sweepVendorOrders({ now: plus(13) });
    equal(r.reminded, 0);                                                                          // never twice
    r = await sweepVendorOrders({ now: plus(25) });
    equal(r.lapsed, 1); equal(r.closed, 0);
    equal((await vo(o1.id, 'A')).status, 'cancelled'); equal((await vo(o3.id, 'A')).status, 'cancelled');
    r = await sweepVendorOrders({ now: plus(73) });
    equal(r.struck, 1);
    r = await sweepVendorOrders({ now: plus(80) });
    equal(r.struck, 0);                                                                            // a strike is issued once
    const reasons = (await strikeMeter(a.id)).strikes.map((s) => s.reason_code).sort().join();
    equal(reasons, 'missed_accept,missed_ready');
  } finally { done(); }
});

test('SETTLEMENT: delivery books the sale to the vendor\'s ledger, net of commission, fees and insurance, and only once', async () => {
  const { done } = await withTestDb();
  try {
    await setDeliveryRate('oversize', 8900, { by: 'admin' });
    const a = await vendor('Alpha', { tier: 2 });                 // 3-day hold
    const l = await listing(a.id, 'A', 1000); const o = await order([unit(l, a, 'A', 1000)], { createdAt: new Date('2026-10-18T12:00:00Z') });
    await confirmVendorOrders(o.id, { now: T0 }); const id = (await vo(o.id, 'A')).id;
    await acceptVendorOrder(a.id, id, { insurance: 'insured', now: plus(1) }); await markVendorOrderReady(a.id, id, { now: plus(30) });
    await onOrderStatus(o.id, 'delivered');
    equal((await vo(o.id, 'A')).status, 'delivered');
    const want = payoutBreakdown({ itemCents: 100000, deliveryServiceCents: 8900, insuranceCents: 1500 });
    const bal = await vendorBalance(a.id, new Date(Date.now() + 10 * 24 * H));
    equal(bal.availableCents, want.payable); equal(bal.reserveHeldCents, want.reserve);
    await onOrderStatus(o.id, 'delivered');                      // a second delivery event writes nothing
    equal((await vendorStatement(a.id)).length, (await vendorStatement(a.id)).length);
    equal((await vendorBalance(a.id, new Date(Date.now() + 10 * 24 * H))).availableCents, want.payable);
    equal((await deliverVendorOrder(id)).already, true);
  } finally { done(); }
});

test('Lane C is delivered by staff once the carrier confirms, and the seller gets 80% of the delivery fee on top', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha', { tier: 2 });
    const c = await listing(a.id, 'C', 500); const o = await order([unit(c, a, 'C', 500)]);
    await confirmVendorOrders(o.id, { now: T0 }); const id = (await vo(o.id, 'C')).id;
    await acceptVendorOrder(a.id, id, { now: plus(1) });
    await markVendorOrderReady(a.id, id, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', now: plus(10) });
    await onOrderStatus(o.id, 'delivered');                      // the order board does NOT settle a seller-shipped unit
    equal((await vo(o.id, 'C')).status, 'ready');
    await deliverVendorOrder(id, { by: 'staff@bb.ca' });
    const want = payoutBreakdown({ itemCents: 50000, laneCDeliveryCents: 6320 });
    equal((await vendorBalance(a.id, new Date(Date.now() + 10 * 24 * H))).availableCents, want.payable);
    equal((await allVendorOrders()).find((x) => x.id === id).status, 'delivered');
  } finally { done(); }
});

test('delivery-service rates: unset until an admin sets them, validated when they are', async () => {
  const { done } = await withTestDb();
  try {
    equal((await deliveryRates()).unset.length, 3);
    await rejects(() => setDeliveryRate('giant', 100, { by: 'a' }), /small, standard or oversize/);
    await rejects(() => setDeliveryRate('small', -5, { by: 'a' }), /zero or more/);
    await rejects(() => setDeliveryRate('small', 5, {}), /Who/);
    await setDeliveryRate('small', 3900, { by: 'a' });
    equal((await deliveryRates()).rates.small, 3900); equal((await deliveryRates()).unset.length, 2);
  } finally { done(); }
});

test('a vendor unit is never written to the tracker as sold, and checkout can buy one only when ordering is open', async () => {
  const { done } = await withTestDb();
  const keys = ['MARKETPLACE_STOREFRONT', 'MARKETPLACE_ORDERING', 'MARKETPLACE_BOOKS_READY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    const a = await vendor('Alpha'); const l = await listing(a.id);
    equal((await markUnitsSold([l.sku], { channel: 'order', ref: 'BB-1' })).sold, 0);
    process.env.MARKETPLACE_STOREFRONT = '1'; delete process.env.MARKETPLACE_ORDERING;
    equal((await getMany([l.sku], { marketplace: true })).length, 0);                // visible, not yet buyable
    process.env.MARKETPLACE_ORDERING = '1';
    equal((await getMany([l.sku], { marketplace: true })).length, 0);                // ordering alone is not enough…
    process.env.MARKETPLACE_BOOKS_READY = '1';
    equal((await getMany([l.sku], { marketplace: true })).length, 1);                // …it needs the books switch too
    equal((await getMany([l.sku])).length, 0);                                       // still opt-in
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    done();
  }
});
