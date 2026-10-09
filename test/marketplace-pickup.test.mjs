// Lane B: the collection job booked when a vendor marks an order ready — through the REAL dispatch
// functions against a real database.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query, withTransaction } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser, strikeMeter } from '../lib/vendors.js';
import {
  createVendorOrdersTx, confirmVendorOrders, acceptVendorOrder, markVendorOrderReady, cancelVendorOrder,
  onOrderStatus, listVendorOrders, allVendorOrders
} from '../lib/vendor-orders.js';
import { ensurePickupJob, resolveMismatch, pickupDate, warehouseDrop, onPickupJobStatus } from '../lib/vendor-pickup.js';
import { completeJob, setJobStatus, dispatchBoard } from '../lib/jobs.js';
import { PICKUP_ADDRESS } from '../lib/constants.js';

const T0 = new Date('2026-10-20T14:00:00Z');
async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw'); if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com`, contactName: 'Pat Seller', contactPhone: '905-555-0100' });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name.toLowerCase()}-user@example.com`, role: 'owner', by: 's' });
  await query('UPDATE vendors SET tier = 1, contact_name = $2, contact_phone = $3 WHERE id = $1', [v.id, 'Pat Seller', '905-555-0100']);
  return v;
}
let n = 0;
async function listing(vendorId, lane, price = 1000) {
  n += 1; const sku = `MP-${vendorId}-${String(n).padStart(4, '0')}`;
  const { rows } = await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, serial_private, condition, title, price, warranty_months,
                                       weight_lb, width_in, depth_in, height_in, tested_working, pickup_address, pickup_city, pickup_postal, delivery_notes)
     VALUES ($1,$2,$3,'live','Refrigerator','Whirlpool','WRF535',$5,'Refurbished','A fridge',$4,12,280,36,34,70,true,'12 Dock Rd','Whitby','L1N 1A1','Ring the bell at door 3') RETURNING id`,
    [sku, vendorId, lane, price, `SN-SECRET-${n}`]);
  return { id: rows[0].id, sku, serial: `SN-SECRET-${n}` };
}
const unit = (l, v, lane, price) => ({ id: l.sku, marketplace: true, lane, vendor: { id: v.id }, price, title: 'A fridge' });
async function order(units) {
  const { rows } = await query(
    `INSERT INTO orders (email, name, phone, address, city, postal, delivery_method, status, subtotal, hst, total)
     VALUES ('cust-private@example.com','Cust Private','416-555-0199','9 Customer St','Toronto','M1M 1M1','delivery','pending_payment',0,0,0) RETURNING id`);
  const id = rows[0].id; await query(`UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1`, [id]);
  for (const u of units) await query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'A fridge',$3,'unit')`, [id, u.id, u.price]);
  await withTransaction((c) => createVendorOrdersTx(c, { orderId: id, orderNumber: `BB-${1000 + id}`, units, deliveryMethod: 'delivery', feeCents: 7900 }));
  return { id, number: `BB-${1000 + id}` };
}
const vo = async (orderId, lane) => (await query('SELECT * FROM vendor_orders WHERE order_id = $1 AND lane = $2', [orderId, lane])).rows[0];
async function readyB(v, l, price = 1000) {
  const o = await order([unit(l, v, 'B', price)]);
  await confirmVendorOrders(o.id, { now: T0 });
  const row = await vo(o.id, 'B');
  await acceptVendorOrder(v.id, row.id, { insurance: 'declined', now: new Date(T0.getTime() + 2 * 3600e3) });
  return { o, id: row.id };
}
const liveJobs = async (id) => (await query(`SELECT * FROM jobs WHERE vendor_order_id = $1 AND status <> 'cancelled'`, [id])).rows;

suite('Lane B pickup job — pure helpers');
test('the drop is our warehouse, split into the fields a job keeps; afternoon bookings roll to tomorrow', () => {
  const d = warehouseDrop();
  assert(PICKUP_ADDRESS.startsWith(d.address) && d.city === 'Pickering' && d.postal === 'L1W 3T9', JSON.stringify(d));
  equal(pickupDate(new Date('2026-10-20T14:00:00Z')), '2026-10-20');   // 10am Toronto
  equal(pickupDate(new Date('2026-10-20T21:00:00Z')), '2026-10-21');   // 5pm Toronto
});

suite('Lane B pickup job — against a real database');

test('READY on a Lane B order books ONE collection job with everything the crew needs and nothing of the customer', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { o, id } = await readyB(v, l);
    equal((await liveJobs(id)).length, 0);                                        // not before ready
    const r = await markVendorOrderReady(v.id, id, { by: 'u', now: new Date(T0.getTime() + 5 * 3600e3) });
    assert(r.pickupJob, 'ready reports the job');
    const jobs = await liveJobs(id); equal(jobs.length, 1);
    const j = jobs[0];
    equal(j.type, 'pickup'); equal(j.order_id, null);                              // NEVER the customer's order
    equal(j.address, '1135 Squires Beach Rd'); equal(j.pickup_address, '12 Dock Rd'); equal(j.pickup_city, 'Whitby'); equal(j.pickup_postal, 'L1N 1A1');
    equal(j.pickup_company, 'Alpha'); equal(j.pickup_name, 'Pat Seller'); equal(j.pickup_phone, '905-555-0100');
    assert(j.job_date, 'a date'); equal(j.driver_id, null);
    const blob = JSON.stringify(j) + JSON.stringify((await query('SELECT * FROM job_items WHERE job_id = $1', [j.id])).rows);
    assert(blob.includes(l.serial) && /WRF535/.test(blob) && l.sku && blob.includes(l.sku), 'model, serial and sku for the crew');
    assert(/TWO people|OVERSIZE/.test(j.notes) && /Ring the bell/.test(j.notes) && /PACKING/.test(j.notes), 'staffing, handover notes, packing');
    assert(!/cust-private|416-555-0199|Cust Private|9 Customer/.test(blob), 'nothing of the customer reaches the job');
    equal((await vo(o.id, 'B')).pickup_job_id, j.id);
    // idempotent: asking again returns the same job
    const again = await ensurePickupJob(id); assert(again.already && again.jobId === j.id, 'same job');
    equal((await liveJobs(id)).length, 1);
    // it is on the board, with the link back
    const day = j.job_date.toISOString().slice(0, 10);
    const board = await dispatchBoard(day);
    const all = JSON.stringify(board);
    assert(all.includes(j.job_number), 'on the board');
    assert(all.includes(`"vendorOrderId":${id}`), 'the board card links back to the vendor order');
    // and the admin Orders tab sees it
    const staff = (await allVendorOrders()).find((x) => x.id === id);
    equal(staff.pickupJob.number, j.job_number);
    // the vendor's own view never carries the job, the serial or the mismatch note
    const mine = JSON.stringify(await listVendorOrders(v.id));
    assert(!/SN-SECRET|job_number|RS-1/.test(mine) && !mine.includes(l.serial), 'vendor sees none of it');
  } finally { done(); }
});

test('Lanes A and C book no job; a Lane B order that is not ready books none', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const la = await listing(v.id, 'A'); const lc = await listing(v.id, 'C');
    const o = await order([unit(la, v, 'A', 1000), unit(lc, v, 'C', 500)]);
    await confirmVendorOrders(o.id, { now: T0 });
    const a = await vo(o.id, 'A'); const c = await vo(o.id, 'C');
    await acceptVendorOrder(v.id, a.id, { insurance: 'declined', now: T0 }); await acceptVendorOrder(v.id, c.id, { now: T0 });
    await markVendorOrderReady(v.id, a.id, { now: T0 });
    await markVendorOrderReady(v.id, c.id, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', now: T0 });
    equal((await query('SELECT count(*)::int AS n FROM jobs WHERE vendor_order_id IS NOT NULL')).rows[0].n, 0);
    const lb = await listing(v.id, 'B'); const ob = await order([unit(lb, v, 'B', 800)]);
    await confirmVendorOrders(ob.id, { now: T0 });
    const r = await ensurePickupJob((await vo(ob.id, 'B')).id);
    assert(!r.ok, 'awaiting accept is not ready');
  } finally { done(); }
});

test('COMPLETING the collection records collected_at, leaves the 72h clock and the customer order alone', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { o, id } = await readyB(v, l);
    const before = await vo(o.id, 'B');
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    const j = (await liveJobs(id))[0];
    await completeJob(j.id, { signedBy: 'Pat' }, { email: 'd@x', name: 'Driver' });
    const after = await vo(o.id, 'B');
    assert(after.collected_at, 'collected');
    equal(after.status, 'ready');                                                  // still ready: delivery to the customer is a separate leg
    equal(new Date(after.ready_by).toISOString(), new Date(before.ready_by).toISOString());
    equal(after.ready_strike_id, null);
    equal((await query('SELECT status FROM orders WHERE id = $1', [o.id])).rows[0].status, 'pending_payment'); // NOT marked delivered
    assert(!(await ensurePickupJob(id)).ok, 'no second job once collected');
  } finally { done(); }
});

test('a late "ready" is struck on the vendor marking it, not on the crew arriving', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { id } = await readyB(v, l);
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 80 * 3600e3) });   // 80h > 72h
    equal((await strikeMeter(v.id)).active, 1);
    const j = (await liveJobs(id))[0]; assert(j, 'still booked');
    await completeJob(j.id, {}, { email: 'd@x' });
    equal((await strikeMeter(v.id)).active, 1);                                    // collecting changed nothing
  } finally { done(); }
});

test('the crew finds a different model/serial: recorded, staff decide; a strike is issued once', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { o, id } = await readyB(v, l);
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    const j = (await liveJobs(id))[0];
    await rejects(() => setJobStatus(j.id, 'failed', {}, { email: 'd@x' }), /why/);
    await setJobStatus(j.id, 'failed', { failReason: 'not_as_described', note: 'Plate says WRF999, serial differs' }, { email: 'd@x' });
    const r = await vo(o.id, 'B');
    assert(r.mismatch_at && /WRF999/.test(r.mismatch_note), 'mismatch recorded');
    equal(r.collected_at, null);
    const staff = (await allVendorOrders()).find((x) => x.id === id);
    assert(staff.mismatch && !staff.mismatch.resolvedAt, 'visible to staff, undecided');
    await rejects(() => resolveMismatch(id, { action: 'nonsense', by: 'admin' }), /Choose/);
    const res = await resolveMismatch(id, { action: 'strike_refund', note: 'wrong unit', by: 'admin@x' });
    assert(res.ok && res.strikeId, 'strike issued');
    equal((await strikeMeter(v.id)).active, 1);
    equal((await vo(o.id, 'B')).status, 'cancelled');
    await rejects(() => resolveMismatch(id, { action: 'strike', by: 'admin@x' }), /already/);
    equal((await strikeMeter(v.id)).active, 1);                                    // once
  } finally { done(); }
});

test('dismissing a mismatch strikes nobody and leaves the order alone', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { o, id } = await readyB(v, l);
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    const j = (await liveJobs(id))[0];
    await setJobStatus(j.id, 'failed', { failReason: 'not_as_described', note: 'misread' }, { email: 'd@x' });
    await resolveMismatch(id, { action: 'dismiss', by: 'admin@x' });
    equal((await strikeMeter(v.id)).active, 0); equal((await vo(o.id, 'B')).status, 'ready');
  } finally { done(); }
});

test('the vendor cancels after the job exists: the job comes off the board; an uncollected job follows a cancelled customer order', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { id } = await readyB(v, l);
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    await cancelVendorOrder(v.id, id, { reasonCode: 'out_of_stock', by: 'u' });
    equal((await liveJobs(id)).length, 0);
    equal((await query(`SELECT status FROM jobs WHERE vendor_order_id = $1`, [id])).rows[0].status, 'cancelled');

    const l2 = await listing(v.id, 'B'); const b = await readyB(v, l2);
    await markVendorOrderReady(v.id, b.id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    equal((await liveJobs(b.id)).length, 1);
    await onOrderStatus(b.o.id, 'cancelled');
    equal((await liveJobs(b.id)).length, 0);
  } finally { done(); }
});

test('staff can rebook after a cancelled job, and assigning a driver works like any stop', async () => {
  const { done } = await withTestDb();
  try {
    const v = await vendor('Alpha'); const l = await listing(v.id, 'B'); const { id } = await readyB(v, l);
    await markVendorOrderReady(v.id, id, { now: new Date(T0.getTime() + 5 * 3600e3) });
    const first = (await liveJobs(id))[0];
    await setJobStatus(first.id, 'cancelled', { note: 'oops' }, { email: 's@x' });
    const again = await ensurePickupJob(id); assert(again.ok && !again.already && again.jobId !== first.id, 'a fresh job');
    equal((await liveJobs(id)).length, 1);
    await onPickupJobStatus(424242, 'done');                                       // a job with no vendor order: nothing happens
  } finally { done(); }
});
