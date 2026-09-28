// lib/purchase-orders.js — what we have ORDERED, as distinct from what arrived.
//
// Stock used to enter the system only when a supplier INVOICE was uploaded, so
// there was no record of what had been ordered, from whom, at what price, or
// when it was due. Nothing could be chased, nothing was ever late, and
// three-way matching was impossible.
//
// That gap produced the 2026-09-17 mess: 64 of the 114 appliances RS Ops held
// were not on the tracker, because nobody had uploaded the invoices that would
// have put them there. The whole stock-reconcile apparatus papers over an
// ordering record that did not exist.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder,
  cancelPurchaseOrder, listPurchaseOrders, outstandingSummary, statusOf
} from '../lib/purchase-orders.js';
import { torontoToday } from '../lib/constants.js';

const fresh = () => withTestDb();
const day = (offset) => {
  const d = new Date(`${torontoToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// A stand-in for the tracker. The real appendIntakeLines needs a Google Sheet;
// what matters here is WHAT WE WOULD SEND IT and what we do with the answer.
function fakeTracker() {
  const calls = [];
  const fn = async (lines, opts) => {
    calls.push({ lines, opts });
    const created = [];
    for (const l of lines) {
      for (let i = 0; i < (l.qty || 1); i++) created.push({ sku: `PO-${created.length + 1}` });
    }
    return { created, count: created.length };
  };
  fn.calls = calls;
  return fn;
}
const refusing = () => async () => { throw new Error('tracker refused'); };

async function po(opts = {}) {
  return createPurchaseOrder({
    vendor: 'SecondShop', orderNumber: 'S-ORD9001', expectedOn: day(7), by: 'owner@x.ca',
    lines: [
      { make: 'LG', model: 'LF25S6206S', category: 'Refrigerator', qty: 3, unitCost: 1250, retail: 2400 },
      { make: 'Whirlpool', model: 'WFE505W0HS', category: 'Range', qty: 2, unitCost: 600, retail: 1100 }
    ],
    ...opts
  });
}

suite('purchase orders — an appliance exists when it is ordered');

test('an order records what was asked for, from whom, and when it is due', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    equal(p.vendor, 'SecondShop');
    equal(p.order_number, 'S-ORD9001');
    equal(p.lines.length, 2);
    equal(p.lines[0].qty, 3);
    equal(p.lines[0].unit_cost, '1250.00', 'the agreed cost, kept exact');
    equal(p.status, 'open', 'nothing received yet');
  } finally { done(); }
});

test('an order needs a supplier and at least one line', async () => {
  const { done } = await fresh();
  try {
    for (const bad of [{ vendor: '' }, { lines: [] }, { lines: [{ qty: 2 }] }]) {
      let err = null;
      try { await po(bad); } catch (e) { err = e; }
      assert(err, `should refuse ${JSON.stringify(bad)}`);
    }
  } finally { done(); }
});

suite('purchase orders — receiving is when stock becomes real');

test('RECEIVED UNITS ARRIVE WITH A COST, so they are not NEEDS INVOICE rows', async () => {
  // The whole point. A unit booked in against an order already knows what we
  // agreed to pay, so it does not wait on an admin approving a fill request.
  const { done } = await fresh();
  try {
    const { id } = await po();
    const tracker = fakeTracker();
    const p = await getPurchaseOrder(id);

    await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 3 }], { by: 'me@x.ca', append: tracker });

    const [call] = tracker.calls;
    equal(call.lines[0].cost, '1250.00', 'the cost went to the tracker');
    equal(call.lines[0].retail, '2400.00');
    equal(call.lines[0].qty, 3);
    equal(call.lines[0].vendor, 'SecondShop');
    equal(call.lines[0].invoice, 'S-ORD9001',
      "the supplier's own number names the lot, so their invoice lands on it later");
  } finally { done(); }
});

test('a partial receipt is normal and leaves the rest outstanding', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    const res = await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 1 }], { append: fakeTracker() });
    equal(res.received, 1);
    equal(res.status, 'partial');

    const after = await getPurchaseOrder(id);
    equal(after.lines[0].qty_received, 1);
    equal(after.lines[1].qty_received, 0);
    equal(after.status, 'partial');
  } finally { done(); }
});

test('receiving everything closes the order', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    const res = await receivePurchaseOrder(id, p.lines.map((l) => ({ lineId: l.id, qty: l.qty })), { append: fakeTracker() });
    equal(res.received, 5);
    equal(res.status, 'received');
  } finally { done(); }
});

test('receipts are CUMULATIVE — a supplier sends what they have', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 1 }], { append: fakeTracker() });
    await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 2 }], { append: fakeTracker() });
    const after = await getPurchaseOrder(id);
    equal(after.lines[0].qty_received, 3);
    equal(after.receipts.length, 2, 'both deliveries are on the record');
  } finally { done(); }
});

test('OVER-RECEIPT IS ALLOWED, and visible', async () => {
  // Refusing it would leave an appliance that is physically here unbooked,
  // which is the original sin this feature exists to end. Suppliers over-ship.
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 5 }], { append: fakeTracker() });
    const after = await getPurchaseOrder(id);
    equal(after.lines[0].qty_received, 5, 'five booked in against three ordered');
    assert(after.lines[0].qty_received > after.lines[0].qty, 'and it is plainly visible');
  } finally { done(); }
});

test('A REFUSED TRACKER WRITE LEAVES NO RECEIPT BEHIND', async () => {
  // The reverse order would record a receipt for stock that is not on the
  // tracker — the exact invisibility this whole feature exists to end. A
  // staging deployment, a duplicate SKU or missing credentials all land here.
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    let err = null;
    try {
      await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 3 }], { append: refusing() });
    } catch (e) { err = e; }
    assert(err, 'the refusal must surface');

    const after = await getPurchaseOrder(id);
    equal(after.lines[0].qty_received, 0, 'nothing was recorded as received');
    equal(after.receipts.length, 0);
    equal(after.status, 'open');
  } finally { done(); }
});

test('which SKUs came off which line is recorded', async () => {
  // Without it, receiving twice by accident is indistinguishable from a genuine
  // second delivery.
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 2 }], { by: 'me@x.ca', append: fakeTracker() });
    const [r] = (await getPurchaseOrder(id)).receipts;
    equal(r.qty, 2);
    equal(r.skus.length, 2);
    equal(r.received_by, 'me@x.ca');
  } finally { done(); }
});

test('nothing can be received against a cancelled order', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    const p = await getPurchaseOrder(id);
    await cancelPurchaseOrder(id, { by: 'owner@x.ca' });
    let err = null;
    try { await receivePurchaseOrder(id, [{ lineId: p.lines[0].id, qty: 1 }], { append: fakeTracker() }); }
    catch (e) { err = e; }
    assert(err, 'should refuse');
    equal((await getPurchaseOrder(id)).status, 'cancelled');
  } finally { done(); }
});

test('receiving nothing, or against a line that is not on the order, is refused', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po();
    for (const bad of [[], [{ lineId: 99999, qty: 1 }], [{ lineId: 1, qty: 0 }]]) {
      let err = null;
      try { await receivePurchaseOrder(id, bad, { append: fakeTracker() }); } catch (e) { err = e; }
      assert(err, `should refuse ${JSON.stringify(bad)}`);
    }
  } finally { done(); }
});

suite('purchase orders — the chase list');

test('WHAT IS OWED TO US, which is the thing that did not exist', async () => {
  const { done } = await fresh();
  try {
    await po({ orderNumber: 'A', expectedOn: day(-5) });   // late
    await po({ orderNumber: 'B', expectedOn: day(+5) });   // due later
    const doneOrder = await po({ orderNumber: 'C', expectedOn: day(-9) });
    const p = await getPurchaseOrder(doneOrder.id);
    await receivePurchaseOrder(doneOrder.id, p.lines.map((l) => ({ lineId: l.id, qty: l.qty })), { append: fakeTracker() });

    const s = await outstandingSummary();
    equal(s.orders, 2, 'the fully received one is not outstanding');
    equal(s.units, 10, 'five units owed on each');
    equal(s.late, 1);
    equal(s.lateUnits, 5);
  } finally { done(); }
});

test('a fully received order is NOT late, whatever its date said', async () => {
  // It arrived. Late is only meaningful for something still owed.
  const { done } = await fresh();
  try {
    const { id } = await po({ expectedOn: day(-30) });
    const p = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, p.lines.map((l) => ({ lineId: l.id, qty: l.qty })), { append: fakeTracker() });
    const [row] = await listPurchaseOrders({ status: 'all' });
    equal(row.status, 'received');
    equal(row.late, false);
  } finally { done(); }
});

test('a cancelled order is never late and never outstanding', async () => {
  const { done } = await fresh();
  try {
    const { id } = await po({ expectedOn: day(-30) });
    await cancelPurchaseOrder(id, { by: 'owner@x.ca' });
    equal((await outstandingSummary()).orders, 0);
    const [row] = await listPurchaseOrders({ status: 'all' });
    equal(row.late, false);
  } finally { done(); }
});

suite('purchase orders — status is derived');

test('status comes from the lines, never from a stored column', () => {
  // Same rule as a part's on-hand and a unit's location: a stored status is a
  // second copy of what the lines already say, and they drift the first time
  // somebody edits a line.
  equal(statusOf({ lines: [] }), 'empty');
  equal(statusOf({ lines: [{ qty: 3, qty_received: 0 }] }), 'open');
  equal(statusOf({ lines: [{ qty: 3, qty_received: 1 }] }), 'partial');
  equal(statusOf({ lines: [{ qty: 3, qty_received: 3 }] }), 'received');
  equal(statusOf({ lines: [{ qty: 3, qty_received: 5 }] }), 'received', 'over-receipt still closes it');
  equal(statusOf({ cancelled_at: new Date(), lines: [{ qty: 3, qty_received: 0 }] }), 'cancelled',
    'cancelled is a decision somebody made, so it IS a column');
});
