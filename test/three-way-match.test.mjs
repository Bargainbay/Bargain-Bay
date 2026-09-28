// Three-way matching: what we ordered, what arrived, what we were billed.
//
// HEADER LEVEL, and that is a real limitation stated rather than hidden.
// purchase_invoices records a vendor, number, date, subtotal, tax, total and a
// UNIT COUNT — there is no line-item table, because intake parses the PDF's
// lines straight into tracker units and keeps only the header for the HST
// credit. So this compares totals and counts, not line against line.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder,
  matchPurchaseOrder, linkInvoiceToPurchaseOrder, suggestPurchaseOrderForInvoice, matchingGaps
} from '../lib/purchase-orders.js';

const fresh = () => withTestDb();
const tracker = () => async (lines) => ({
  created: lines.flatMap((l, i) => Array.from({ length: l.qty || 1 }, (_, j) => ({ sku: `PO-${i}-${j}` }))),
  count: lines.reduce((a, l) => a + (l.qty || 1), 0)
});

async function order(opts = {}) {
  return createPurchaseOrder({
    vendor: 'SecondShop', orderNumber: 'S-ORD9001',
    lines: [{ make: 'LG', model: 'LF25S6206S', qty: 2, unitCost: 1250 }],
    ...opts
  });
}
async function invoice(client, { vendor = 'SecondShop', number = 'S-ORD9001', units = 2, subtotal = 2500, poId = null }) {
  const { rows } = await client.query(
    `INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total, units, po_id)
     VALUES ($1,$2,CURRENT_DATE,$3,0,$3,$4,$5) RETURNING id`,
    [vendor, number, subtotal, units, poId]
  );
  return rows[0].id;
}

suite('three-way match — when the three agree');

test('ordered, received and billed all line up, with no problems', async () => {
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 2 }], { append: tracker() });
    await invoice(client, { poId: id, units: 2, subtotal: 2500 });

    const m = await matchPurchaseOrder(id);
    equal(m.ordered, 2);
    equal(m.received, 2);
    equal(m.invoicedUnits, 2);
    equal(m.value, 2500);
    equal(m.invoicedValue, 2500);
    equal(m.problems, []);
    equal(m.headerLevelOnly, true, 'said out loud, so a clean match is not read as line-by-line');
  } finally { done(); }
});

test('a couple of cents is rounding, not a discrepancy', async () => {
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 2 }], { append: tracker() });
    await invoice(client, { poId: id, units: 2, subtotal: 2500.40 });
    equal((await matchPurchaseOrder(id)).problems, []);
  } finally { done(); }
});

suite('three-way match — what it catches');

test('STOCK ARRIVED THAT NOBODY BILLED US FOR', async () => {
  // Real money: the cost is not in the books and no HST has been reclaimed on
  // it. This is the failure the old flow could not even represent.
  const { done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 2 }], { append: tracker() });

    const m = await matchPurchaseOrder(id);
    const p = m.problems.find((x) => x.kind === 'received_not_invoiced');
    assert(p, 'must be flagged');
    equal(p.severity, 'high');
    assert(/HST/.test(p.text), 'and says why it matters');
  } finally { done(); }
});

test('billed for more than arrived is HIGH; fewer is not', async () => {
  // Being billed for stock that never came is somebody else's mistake costing
  // us money. Being billed for less usually just means an invoice is still on
  // its way.
  const { client, done } = await fresh();
  try {
    const a = await order({ orderNumber: 'A' });
    const poA = await getPurchaseOrder(a.id);
    await receivePurchaseOrder(a.id, [{ lineId: poA.lines[0].id, qty: 1 }], { append: tracker() });
    await invoice(client, { poId: a.id, number: 'A', units: 2, subtotal: 2500 });
    const over = (await matchPurchaseOrder(a.id)).problems.find((x) => x.kind === 'count_mismatch');
    equal(over.severity, 'high');
    assert(/Billed for 2 but only 1 arrived/.test(over.text));

    const b = await order({ orderNumber: 'B' });
    const poB = await getPurchaseOrder(b.id);
    await receivePurchaseOrder(b.id, [{ lineId: poB.lines[0].id, qty: 2 }], { append: tracker() });
    await invoice(client, { poId: b.id, number: 'B', units: 1, subtotal: 1250 });
    const under = (await matchPurchaseOrder(b.id)).problems.find((x) => x.kind === 'count_mismatch');
    equal(under.severity, 'low');
    assert(/may still be coming/.test(under.text));
  } finally { done(); }
});

test('being charged more than we agreed is flagged', async () => {
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 2 }], { append: tracker() });
    await invoice(client, { poId: id, units: 2, subtotal: 2900 });

    const p = (await matchPurchaseOrder(id)).problems.find((x) => x.kind === 'value_mismatch');
    equal(p.severity, 'high');
    assert(/400\.00/.test(p.text), 'the difference is stated, not left to be worked out');
  } finally { done(); }
});

test('the SUBTOTAL is compared, not the total', async () => {
  // We agreed a price for the goods. The tax on top is reclaimed, not spent —
  // comparing the total would flag every invoice in the country as 13% over.
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 2 }], { append: tracker() });
    await client.query(
      `INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total, units, po_id)
       VALUES ('SecondShop','S-ORD9001',CURRENT_DATE,2500,325,2825,2,$1)`, [id]
    );
    equal((await matchPurchaseOrder(id)).problems, [], 'the HST is not a discrepancy');
  } finally { done(); }
});

suite('three-way match — linking');

test('nothing links automatically; it SUGGESTS', async () => {
  // Matching on a number that "looks like" the order's is exactly how the
  // S-ORD115612 / PS-INV116968 tangle happened.
  const { client, done } = await fresh();
  try {
    const { id } = await order({ orderNumber: 'S-ORD9001' });
    await order({ orderNumber: 'S-ORD9002' });
    const invId = await invoice(client, { number: 'S-ORD9001', poId: null });

    equal((await matchPurchaseOrder(id)).invoices.length, 0, 'not linked on its own');

    const [best] = await suggestPurchaseOrderForInvoice(invId);
    equal(best.id, id, 'the exact order number sorts first');
    assert(best.exact, 'and is marked as an exact match');
  } finally { done(); }
});

test('suggestions stay within the same supplier', async () => {
  const { client, done } = await fresh();
  try {
    await order({ vendor: 'SecondShop', orderNumber: 'X-1' });
    const invId = await invoice(client, { vendor: 'Someone Else', number: 'X-1' });
    equal(await suggestPurchaseOrderForInvoice(invId), [], 'a matching number on another supplier is not a match');
  } finally { done(); }
});

test('linking is explicit, reversible, and refuses a ghost order', async () => {
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const invId = await invoice(client, { poId: null });

    await linkInvoiceToPurchaseOrder(invId, id, { by: 'owner@x.ca' });
    equal((await matchPurchaseOrder(id)).invoices.length, 1);

    await linkInvoiceToPurchaseOrder(invId, null, { by: 'owner@x.ca' });
    equal((await matchPurchaseOrder(id)).invoices.length, 0, 'a wrong link can be undone');

    let err = null;
    try { await linkInvoiceToPurchaseOrder(invId, 99999); } catch (e) { err = e; }
    assert(err, 'a ghost order is refused');
  } finally { done(); }
});

suite('three-way match — the two lists worth looking at');

test('unbilled receipts and unmatched invoices, both with their value', async () => {
  const { client, done } = await fresh();
  try {
    // Received, never billed.
    const a = await order({ orderNumber: 'A' });
    const poA = await getPurchaseOrder(a.id);
    await receivePurchaseOrder(a.id, [{ lineId: poA.lines[0].id, qty: 2 }], { append: tracker() });

    // An invoice belonging to no order: bought outside the process, or an order
    // was never raised.
    await invoice(client, { vendor: 'Nobody', number: 'Z-9', units: 1, subtotal: 400, poId: null });

    // Properly matched — should appear in neither list.
    const c = await order({ orderNumber: 'C' });
    const poC = await getPurchaseOrder(c.id);
    await receivePurchaseOrder(c.id, [{ lineId: poC.lines[0].id, qty: 2 }], { append: tracker() });
    await invoice(client, { number: 'C', poId: c.id });

    const g = await matchingGaps({});
    equal(g.unbilled.map((r) => r.order_number), ['A']);
    equal(g.unbilledValue, 2500, 'what its cost is worth, unrecorded in the books');
    equal(g.unmatched.map((r) => r.invoice_number), ['Z-9']);
    equal(g.unmatchedValue, 400);
  } finally { done(); }
});

test('an order with nothing received yet is not "unbilled"', async () => {
  // It is simply not here. Nothing is owed to the books for it.
  const { done } = await fresh();
  try {
    await order();
    equal((await matchingGaps({})).unbilled, []);
  } finally { done(); }
});

test('a cancelled order never appears in the gaps', async () => {
  const { client, done } = await fresh();
  try {
    const { id } = await order();
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 1 }], { append: tracker() });
    await client.query('UPDATE purchase_orders SET cancelled_at = now() WHERE id = $1', [id]);
    equal((await matchingGaps({})).unbilled, []);
  } finally { done(); }
});
