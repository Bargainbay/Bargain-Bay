// lib/suppliers.js — who we buy from.
//
// A supplier has been a string typed by hand on every path that touches one, so
// "SecondShop", "Second Shop" and "secondshop " were three suppliers on a report
// and one company in the driveway — with nowhere to record their terms, who to
// ring, or whether they turn up when they said they would.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  createSupplier, updateSupplier, resolveSupplier, addSupplierAlias,
  unknownVendorNames, supplierPerformance, payablesAging, listSuppliers, relinkAll
} from '../lib/suppliers.js';
import { createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder } from '../lib/purchase-orders.js';
import { supplierKey, torontoToday } from '../lib/constants.js';

const fresh = () => withTestDb();
const tracker = () => async (lines) => ({
  created: lines.flatMap((l, i) => Array.from({ length: l.qty || 1 }, (_, j) => ({ sku: `S-${i}-${j}` }))),
  count: lines.reduce((a, l) => a + (l.qty || 1), 0)
});
const day = (o) => {
  const d = new Date(`${torontoToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const invoice = (c, { vendor, number, total = 1000, date, supplierId = null, paid = null }) =>
  c.query(
    `INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total, units, supplier_id, paid_at)
     VALUES ($1,$2,$3,$4,0,$4,1,$5,$6)`,
    [vendor, number, date || torontoToday(), total, supplierId, paid]
  );

suite('suppliers — one company, however it was spelled');

test('the fold rule is the one lib/stock-vendors has always used', () => {
  // The supplier list and the By vendor tab must agree about how many suppliers
  // there are, so both fold identically.
  equal(supplierKey('SecondShop'), 'secondshop');
  equal(supplierKey('Second Shop'), 'secondshop');
  equal(supplierKey('  secondshop  '), 'secondshop');
  equal(supplierKey('S.S. Appliances'), 'ssappliances');
  equal(supplierKey(''), null);
  equal(supplierKey('   '), null);
});

test('spellings of one name are one supplier', async () => {
  const { done } = await fresh();
  try {
    const a = await createSupplier({ name: 'SecondShop', termsDays: 30 });
    assert(a.created);
    const again = await createSupplier({ name: 'Second Shop' });
    equal(again.created, false, 'not a second supplier');
    equal(again.id, a.id, 'and the caller gets the one that exists');
    equal((await listSuppliers()).length, 1);
  } finally { done(); }
});

test('an alias resolves, and cannot be stolen from another supplier', async () => {
  const { done } = await fresh();
  try {
    const ss = await createSupplier({ name: 'SecondShop' });
    const cda = await createSupplier({ name: 'Canadian Discount Appliances' });
    await addSupplierAlias(ss.id, 'SS');
    await addSupplierAlias(cda.id, 'CDA');

    equal((await resolveSupplier('SS')).id, ss.id);
    equal((await resolveSupplier('cda')).id, cda.id, 'folded, so case does not matter');

    let err = null;
    try { await addSupplierAlias(cda.id, 'Second Shop'); } catch (e) { err = e; }
    assert(err, 'a name that already belongs to somebody is refused');
    assert(/SecondShop/.test(err.message), 'and says who has it');
  } finally { done(); }
});

test('A NAME NEVER CREATES A SUPPLIER', async () => {
  // Same rule client-match follows: a list full of typos is a list nobody can
  // raise a purchase order from.
  const { done } = await fresh();
  try {
    equal(await resolveSupplier('Somebody Nobody Added'), null);
    equal(await listSuppliers(), []);
  } finally { done(); }
});

test('a supplier needs a name that folds to something', async () => {
  const { done } = await fresh();
  try {
    for (const bad of ['', '   ', '!!!']) {
      let err = null;
      try { await createSupplier({ name: bad }); } catch (e) { err = e; }
      assert(err, `"${bad}" should be refused`);
    }
  } finally { done(); }
});

suite('suppliers — purchase orders find them');

test('raising an order attaches it to the supplier by the name typed', async () => {
  const { client, done } = await fresh();
  try {
    const s = await createSupplier({ name: 'SecondShop' });
    const { id } = await createPurchaseOrder({
      vendor: 'second shop', lines: [{ model: 'X', qty: 1, unitCost: 100 }]
    });
    const { rows } = await client.query('SELECT supplier_id, vendor FROM purchase_orders WHERE id = $1', [id]);
    equal(rows[0].supplier_id, s.id, 'resolved through the fold');
    equal(rows[0].vendor, 'second shop', 'and the name typed is still what is written down');
  } finally { done(); }
});

test('AN UNKNOWN SUPPLIER DOES NOT STOP AN ORDER', async () => {
  // Failing to recognise a name must never stop a purchase order being raised.
  const { client, done } = await fresh();
  try {
    const { id } = await createPurchaseOrder({
      vendor: 'Never Heard Of Them', lines: [{ model: 'X', qty: 1, unitCost: 100 }]
    });
    const { rows } = await client.query('SELECT supplier_id FROM purchase_orders WHERE id = $1', [id]);
    equal(rows[0].supplier_id, null);
    const unknown = await unknownVendorNames({});
    equal(unknown.map((r) => r.vendor), ['Never Heard Of Them'], 'it turns up on the list to answer');
  } finally { done(); }
});

test('adding the supplier afterwards folds the history onto them', async () => {
  const { client, done } = await fresh();
  try {
    await createPurchaseOrder({ vendor: 'SecondShop', lines: [{ model: 'X', qty: 1, unitCost: 100 }] });
    await invoice(client, { vendor: 'second shop', number: 'I-1' });
    equal((await unknownVendorNames({})).length, 2);

    const s = await createSupplier({ name: 'Second Shop' });
    const r = await relinkAll();
    equal(r.linked, 2, 'both the order and the invoice');
    equal(await unknownVendorNames({}), []);

    const { rows } = await client.query('SELECT supplier_id FROM purchase_invoices', []);
    equal(rows[0].supplier_id, s.id);
  } finally { done(); }
});

suite('suppliers — do they turn up when they said');

test('ON-TIME IS NULL, NOT 100%, WITH NOTHING TO MEASURE', async () => {
  // A percentage computed from nothing looks like a fact.
  const { done } = await fresh();
  try {
    await createSupplier({ name: 'Untested Supplier' });
    const [p] = await supplierPerformance({});
    equal(p.orders, 0);
    equal(p.onTimePct, null, 'no orders with dates is not "never late"');
  } finally { done(); }
});

test('an order received by its due date counts as on time', async () => {
  const { done } = await fresh();
  try {
    await createSupplier({ name: 'SecondShop' });
    const early = await createPurchaseOrder({
      vendor: 'SecondShop', orderNumber: 'A', expectedOn: day(5),
      lines: [{ model: 'X', qty: 1, unitCost: 100 }]
    });
    const late = await createPurchaseOrder({
      vendor: 'SecondShop', orderNumber: 'B', expectedOn: day(-5),
      lines: [{ model: 'Y', qty: 1, unitCost: 100 }]
    });
    for (const o of [early, late]) {
      const po = await getPurchaseOrder(o.id);
      await receivePurchaseOrder(o.id, [{ lineId: po.lines[0].id, qty: 1 }], { append: tracker() });
    }
    const [p] = await supplierPerformance({});
    equal(p.dated, 2);
    equal(p.on_time, 1, 'the one whose due date had not passed');
    equal(p.onTimePct, 50);
    equal(p.orderedValue, 200);
  } finally { done(); }
});

test('an order with no expected date is not counted either way', async () => {
  const { done } = await fresh();
  try {
    await createSupplier({ name: 'SecondShop' });
    const { id } = await createPurchaseOrder({
      vendor: 'SecondShop', lines: [{ model: 'X', qty: 1, unitCost: 100 }]
    });
    const po = await getPurchaseOrder(id);
    await receivePurchaseOrder(id, [{ lineId: po.lines[0].id, qty: 1 }], { append: tracker() });
    const [p] = await supplierPerformance({});
    equal(p.orders, 1, 'the order counts for spend');
    equal(p.dated, 0, 'but there was nothing to be on time for');
    equal(p.onTimePct, null);
  } finally { done(); }
});

suite('suppliers — what is owed and when');

test('terms decide the due date, and the buckets measure days past DUE', async () => {
  // Not days since the invoice — an easy thing to misread. With 30-day terms an
  // invoice raised 45 days ago is fifteen days past due, which is "overdue",
  // not "more than thirty days overdue". The dates below are written as
  // (age since invoice) with the resulting position spelled out.
  const { client, done } = await fresh();
  try {
    const s = await createSupplier({ name: 'SecondShop', termsDays: 30 });
    await invoice(client, { vendor: 'SecondShop', number: 'VERY_LATE', date: day(-75), total: 500, supplierId: s.id }); // due 45d ago
    await invoice(client, { vendor: 'SecondShop', number: 'LATE',      date: day(-45), total: 300, supplierId: s.id }); // due 15d ago
    await invoice(client, { vendor: 'SecondShop', number: 'SOON',      date: day(-27), total: 200, supplierId: s.id }); // due in 3d
    await invoice(client, { vendor: 'SecondShop', number: 'LATER',     date: day(-2),  total: 100, supplierId: s.id }); // due in 28d

    const a = await payablesAging();
    equal(a.over30.map((r) => r.invoice_number), ['VERY_LATE'], 'more than 30 days PAST DUE');
    equal(a.overdue.map((r) => r.invoice_number), ['LATE']);
    equal(a.week.map((r) => r.invoice_number), ['SOON'], 'due within the week');
    equal(a.later.map((r) => r.invoice_number), ['LATER']);
    equal(a.totals.over30, 500);
    equal(a.total, 1100);
  } finally { done(); }
});

test('UNKNOWN TERMS ARE UNKNOWN, never assumed to be due on receipt', async () => {
  // Assuming zero would show every unpaid invoice from a supplier nobody has
  // set terms for as overdue, which is the fastest way to make an aging report
  // ignored.
  const { client, done } = await fresh();
  try {
    const s = await createSupplier({ name: 'No Terms Yet' });
    await invoice(client, { vendor: 'No Terms Yet', number: 'X', date: day(-90), total: 900, supplierId: s.id });
    const a = await payablesAging();
    equal(a.unknownTerms.map((r) => r.invoice_number), ['X']);
    equal(a.overdue, []);
    equal(a.over30, [], 'ninety days old and still not called overdue');
    equal(a.totals.unknown, 900);
  } finally { done(); }
});

test('an invoice with no supplier at all still shows as unknown', async () => {
  const { client, done } = await fresh();
  try {
    await invoice(client, { vendor: 'Nobody', number: 'Y', date: day(-60), total: 400 });
    equal((await payablesAging()).unknownTerms.map((r) => r.invoice_number), ['Y']);
  } finally { done(); }
});

test('a paid invoice is not owed', async () => {
  const { client, done } = await fresh();
  try {
    const s = await createSupplier({ name: 'SecondShop', termsDays: 30 });
    await invoice(client, { vendor: 'SecondShop', number: 'PAID', date: day(-90), total: 500, supplierId: s.id, paid: day(-60) });
    const a = await payablesAging();
    equal(a.total, 0);
    equal(a.over30, []);
  } finally { done(); }
});

test('terms can be set later, and cleared', async () => {
  const { done } = await fresh();
  try {
    const s = await createSupplier({ name: 'SecondShop' });
    await updateSupplier(s.id, { termsDays: 45, contactName: 'Ali' });
    let [row] = await listSuppliers();
    equal(row.terms_days, 45);
    equal(row.contact_name, 'Ali');

    await updateSupplier(s.id, { note: 'delivers Tuesdays' });
    [row] = await listSuppliers();
    equal(row.terms_days, 45, 'an unrelated edit does not wipe the terms');

    await updateSupplier(s.id, { termsDays: null });
    [row] = await listSuppliers();
    equal(row.terms_days, null, 'and they can be cleared deliberately');
  } finally { done(); }
});
