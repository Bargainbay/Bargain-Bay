// Lane B collection fees: zone (driving distance) x size, the starter schedule, and what accept charges.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query, withTransaction } from '../lib/db.js';
import { createApplication, grantVendorUser } from '../lib/vendors.js';
import { decideApplication } from './approved-vendor.mjs';
import { zoneForKm, zoneRateTable, collectionFeeCents, STARTER_ZONE_RATES } from '../lib/pickup-zones.js';
import { createVendorOrdersTx, confirmVendorOrders, acceptVendorOrder, setZoneRate, deliveryZoneRates } from '../lib/vendor-orders.js';
import { reviewListing, ensurePickupDistance } from '../lib/marketplace-listings.js';
import { drivingKm } from '../lib/pickup-distance.js';

async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw'); if (re) assert(re.test(err.message), `message was: ${err.message}`);
}
const T0 = new Date('2026-10-20T14:00:00Z');
const plus = (h) => new Date(T0.getTime() + h * 3600000);

suite('pickup zones (pure)');

test('bands match the customer shipping policy; unknown and out-of-range are null, never a guess', () => {
  equal(zoneForKm(0), 1); equal(zoneForKm(50), 1); equal(zoneForKm(50.1), 2); equal(zoneForKm(100), 2);
  equal(zoneForKm(100.1), 3); equal(zoneForKm(150), 3); equal(zoneForKm(150.1), null);
  equal(zoneForKm(null), null); equal(zoneForKm(''), null); equal(zoneForKm(-3), null); equal(zoneForKm('abc'), null);
});

test('saved cells beat the starter cell by cell, and the table says which is which', () => {
  const t = zoneRateTable([{ zone: 2, size_class: 'standard', cents: 15000 }]);
  equal(t.rates[2].standard, 15000); equal(t.isStarter[2].standard, false);
  equal(t.rates[2].small, STARTER_ZONE_RATES[2].small); equal(t.isStarter[2].small, true);
  equal(collectionFeeCents(t, 75, 'standard'), 15000); equal(collectionFeeCents(t, 200, 'standard'), null);
  assert(STARTER_ZONE_RATES[3].oversize > STARTER_ZONE_RATES[1].small, 'farther and bigger costs more');
});

test('no server key means no lookup, and no lookup never invents a distance', async () => {
  const k = process.env.GOOGLE_MAPS_SERVER_KEY; delete process.env.GOOGLE_MAPS_SERVER_KEY;
  try { equal(await drivingKm({ address: '1 Main St', city: 'Toronto' }), null); } finally { if (k) process.env.GOOGLE_MAPS_SERVER_KEY = k; }
});

suite('Lane B collection fee — against a real database');

async function vendor() {
  const v = await createApplication({ legalName: 'Zeta', contactEmail: 'zeta@example.com' });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: 'zeta-user@example.com', role: 'owner', by: 's' });
  return v;
}
let n = 0;
async function laneB(vendorId, { km = null, status = 'live', weight = 280 } = {}) {
  n += 1; const sku = `MP-${vendorId}-${String(n).padStart(4, '0')}`;
  const { rows } = await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working, pickup_address, pickup_city, pickup_km)
     VALUES ($1,$2,'B',$3,'Refrigerator','Whirlpool','WRF535','Refurbished','A fridge',1000,12,$4,36,34,70,true,'1 Dock Rd','Oshawa',$5) RETURNING id`, [sku, vendorId, status, weight, km]);
  return { id: rows[0].id, sku };
}
async function orderFor(v, l) {
  const { rows } = await query(`INSERT INTO orders (email, name, delivery_method, status, subtotal, hst, total) VALUES ('c@example.com','C','delivery','pending_payment',0,0,0) RETURNING id`);
  const id = rows[0].id; await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [id]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'A fridge',1000,'unit')`, [id, l.sku]);
  await withTransaction((c) => createVendorOrdersTx(c, { orderId: id, orderNumber: `BB-${1000 + id}`, units: [{ id: l.sku, marketplace: true, lane: 'B', vendor: { id: v.id }, price: 1000, title: 'A fridge' }], deliveryMethod: 'delivery', feeCents: 7900 }));
  await confirmVendorOrders(id, { now: T0 });
  return (await query('SELECT * FROM vendor_orders WHERE order_id = $1', [id])).rows[0];
}

test('accept charges the zone x size fee, saved cells win, and the itemisation is kept', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor(); const l = await laneB(v.id, { km: 72.4 });
    await setZoneRate(2, 'oversize', 21000, { by: 'admin' });
    const vo = await orderFor(v, l);
    await acceptVendorOrder(v.id, vo.id, { insurance: 'declined', now: plus(1) });
    const r = (await query('SELECT * FROM vendor_orders WHERE id = $1', [vo.id])).rows[0];
    equal(Number(r.delivery_service_cents), 21000);
    const d = r.delivery_service_detail; equal(d[0].zone, 2); equal(d[0].km, 72.4); equal(d[0].size, 'oversize'); equal(d[0].cents, 21000);
    await setZoneRate(2, 'oversize', 99900, { by: 'admin' });                                      // a later change must not rewrite the past
    equal(Number((await query('SELECT delivery_service_cents FROM vendor_orders WHERE id = $1', [vo.id])).rows[0].delivery_service_cents), 21000);
  } finally { done(); }
});

test('a listing with no recorded distance is charged zone 1 and flagged, never refused or struck', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor(); const l = await laneB(v.id, { km: null });
    const vo = await orderFor(v, l);
    await acceptVendorOrder(v.id, vo.id, { insurance: 'declined', now: plus(1) });
    const r = (await query('SELECT * FROM vendor_orders WHERE id = $1', [vo.id])).rows[0];
    equal(Number(r.delivery_service_cents), STARTER_ZONE_RATES[1].oversize);
    assert(r.delivery_service_detail[0].unverifiedDistance === true, 'flagged');
  } finally { done(); }
});

test('review: Lane B cannot be approved without a distance inside 150 km; staff can type one', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor(); const l = await laneB(v.id, { km: null, status: 'in_review' });
    await rejects(() => reviewListing(l.id, { decision: 'approve', by: 'staff' }), /driving distance/);
    await rejects(() => reviewListing(l.id, { decision: 'approve', by: 'staff', pickupKm: 210 }), /150 km/);
    await rejects(() => reviewListing(l.id, { decision: 'approve', by: 'staff', pickupKm: 'abc' }), /kilometres/);
    equal((await reviewListing(l.id, { decision: 'approve', by: 'staff', pickupKm: 41 })).status, 'live');
    const r = (await query('SELECT pickup_km, pickup_km_source FROM marketplace_listings WHERE id = $1', [l.id])).rows[0];
    equal(Number(r.pickup_km), 41); equal(r.pickup_km_source, 'staff');
    equal(await ensurePickupDistance(l.id), null);                                                  // never overwrites, and no key means no lookup
  } finally { done(); }
});

test('rates are validated and the table reads back with starters for unsaved cells', async () => {
  const { done } = await withTestDb();
  try {
    await rejects(() => setZoneRate(4, 'small', 100, { by: 'a' }), /zone/i);
    await rejects(() => setZoneRate(1, 'giant', 100, { by: 'a' }), /small, standard or oversize/);
    await rejects(() => setZoneRate(1, 'small', -1, { by: 'a' }), /zero or more/);
    await setZoneRate(1, 'small', 5500, { by: 'a' });
    const t = await deliveryZoneRates();
    equal(t.rates[1].small, 5500); equal(t.isStarter[1].small, false); equal(t.isStarter[3].oversize, true);
  } finally { done(); }
});
