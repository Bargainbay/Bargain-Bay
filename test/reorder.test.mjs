// lib/reorder.js — when to buy more of a part.
//
// The shelf could always say it was empty; nothing said it was about to be. The
// three rules under test are the ones that decide whether this list is worth
// opening: it counts what is AVAILABLE rather than what is on the shelf, a part
// with no reorder point is unwatched rather than fine, and a suggestion is only
// made when both halves of it were actually measured.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { reorderReport, setReorderPoint, suggestReorderPoint, USAGE_WINDOW_DAYS } from '../lib/reorder.js';
import { addPart, receiveParts, usePart, requestPart, ensurePartSchema } from '../lib/parts.js';
import { createSupplier } from '../lib/suppliers.js';
import { createPurchaseOrder } from '../lib/purchase-orders.js';

const fresh = () => withTestDb();

// A part with `n` pieces on the shelf.
async function stocked(name, n, opts = {}) {
  const p = await addPart({ name, ...opts });
  // No location: `warehouse_locations` is seeded at RUNTIME by the locations
  // module, so a database built from migrations alone has no spots and
  // receiveParts rightly refuses one that does not exist. Where a piece sits is
  // lib/locations' business; this file is about how many there are.
  if (n > 0) await receiveParts({ partId: p.id, qty: n, cost: 10 });
  return p.id;
}
const find = (list, name) => list.find((r) => r.name === name);

// The harness's `assert` is a plain function, not node:assert — so a rejection
// is checked by catching it.
async function refuses(fn, re, what) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert(err, `${what} should have been refused`);
  assert(re.test(err.message), `${what}: wrong message — ${err.message}`);
}

suite('reorder — a held part is not a part you have');
test('THE LAST ONE, PROMISED TO A TECH, IS NOT STOCK', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Igniter', 3);
    await setReorderPoint(id, { point: 2 });

    // Three on the shelf against a point of 2 — nothing to do.
    let r = await reorderReport();
    equal(r.counts.toBuy, 0, 'three on hand is above a point of two');

    // A tech asks for one. It is still physically on the shelf and it is
    // SPOKEN FOR: available is 2, which is at the point.
    await requestPart({ partId: id, qty: 1, reason: 'warranty call' });
    r = await reorderReport();
    equal(r.counts.toBuy, 1, 'a held piece does not count as stock');
    const row = find(r.below, 'Igniter');
    equal(row.onHand, 3, 'still three on the shelf');
    equal(row.held, 1);
    equal(row.available, 2, 'and only two anybody can have');
  } finally { done(); }
});

test('at the point counts as below it — the point is what you want LEFT', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Thermostat', 2);
    await setReorderPoint(id, { point: 2 });
    const r = await reorderReport();
    equal(r.counts.toBuy, 1, 'two against a point of two trips it');
  } finally { done(); }
});

suite('reorder — no point set is UNWATCHED, never fine and never urgent');
test('a part nobody has set a point for is reported as unwatched', async () => {
  const { done } = await fresh();
  try {
    await stocked('Door seal', 0);          // empty, and unwatched
    await stocked('Drain pump', 5);
    const r = await reorderReport();

    equal(r.counts.unwatched, 2, 'both are unwatched');
    equal(r.counts.watched, 0);
    equal(r.counts.toBuy, 0, 'an empty shelf with no point set is NOT a buy');
    equal(r.below.length, 0);
    // The point of the group: it is listed, so the gap is visible.
    assert(find(r.unwatched, 'Door seal'), 'and it is on the unwatched list');
  } finally { done(); }
});

test('clearing a point stops watching, and is not a zero', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Belt', 0);
    await setReorderPoint(id, { point: 1 });
    equal((await reorderReport()).counts.toBuy, 1);

    await setReorderPoint(id, { point: null });
    const r = await reorderReport();
    equal(r.counts.toBuy, 0, 'cleared means unwatched');
    equal(r.counts.unwatched, 1);
    equal(find(r.unwatched, 'Belt').reorderPoint, null, 'null, not 0');
  } finally { done(); }
});

test('a point of ZERO is a real setting — buy when it runs out, not before', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Filter', 1);
    await setReorderPoint(id, { point: 0 });
    equal((await reorderReport()).counts.toBuy, 0, 'one left is above a point of zero');
    await usePart({ partId: id, qty: 1 });
    equal((await reorderReport()).counts.toBuy, 1, 'now it is out');
  } finally { done(); }
});

test('a partial update never blanks the other fields', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Hinge', 0);
    await setReorderPoint(id, { point: 4, qty: 10 });
    await setReorderPoint(id, { point: 6 });          // says nothing about qty
    const row = find((await reorderReport()).watched, 'Hinge');
    equal(row.reorderPoint, 6);
    equal(row.reorderQty, 10, 'the order quantity survived');
  } finally { done(); }
});

suite('reorder — what is already on its way');
test('a part on an open purchase order moves OFF the buy list, not out of sight', async () => {
  const { done, client } = await fresh();
  try {
    const id = await stocked('Control board', 1);
    await setReorderPoint(id, { point: 3 });
    equal((await reorderReport()).counts.toBuy, 1);

    const po = await createPurchaseOrder({
      vendor: 'PartsCo', lines: [{ description: 'Control board', qty: 5 }]
    });
    await client.query(`UPDATE purchase_order_lines SET part_id = $1 WHERE po_id = $2`, [id, po.id]);

    const r = await reorderReport();
    equal(r.counts.toBuy, 0, 'nothing to do — it is ordered');
    equal(r.below.length, 0);
    // But still visibly short, because "did somebody order it" is the first
    // question anybody asks about a part that is out.
    equal(r.onOrder.length, 1, 'and it says so in its own group');
    equal(find(r.onOrder, 'Control board').onOrder, 5);
  } finally { done(); }
});

test('a CANCELLED order is not on its way', async () => {
  const { done, client } = await fresh();
  try {
    const id = await stocked('Capacitor', 0);
    await setReorderPoint(id, { point: 2 });
    const po = await createPurchaseOrder({ vendor: 'PartsCo', lines: [{ description: 'Capacitor', qty: 4 }] });
    await client.query(`UPDATE purchase_order_lines SET part_id = $1 WHERE po_id = $2`, [id, po.id]);
    await client.query(`UPDATE purchase_orders SET cancelled_at = now() WHERE id = $1`, [po.id]);

    const r = await reorderReport();
    equal(r.counts.toBuy, 1, 'a cancelled order buys nothing');
    equal(find(r.below, 'Capacitor').onOrder, 0);
  } finally { done(); }
});

test('only the part of an order still OWED counts', async () => {
  const { done, client } = await fresh();
  try {
    const id = await stocked('Valve', 0);
    await setReorderPoint(id, { point: 5 });
    const po = await createPurchaseOrder({ vendor: 'PartsCo', lines: [{ description: 'Valve', qty: 6 }] });
    await client.query(
      `UPDATE purchase_order_lines SET part_id = $1, qty_received = 6 WHERE po_id = $2`, [id, po.id]
    );
    const r = await reorderReport();
    equal(find([...r.below, ...r.onOrder], 'Valve').onOrder, 0, 'fully received owes nothing');
  } finally { done(); }
});

suite('reorder — usage, and what it will not guess');
test('a rate is measured from takes, and a correction is NOT a take', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Element', 40);
    await usePart({ partId: id, qty: 9, reason: 'use_unit' });
    // A miscount being put right. Counting it as demand would order more of
    // something nobody used.
    await usePart({ partId: id, qty: 6, reason: 'adjust' });

    const row = find((await reorderReport()).unwatched, 'Element');
    equal(row.used, 9, 'nine used, not fifteen');
    equal(row.onHand, 25, 'the shelf still lost both');
  } finally { done(); }
});

test('a part nobody has ever used has NO rate and NO days of cover', async () => {
  const { done } = await fresh();
  try {
    await stocked('Spare knob', 12);
    const row = find((await reorderReport()).unwatched, 'Spare knob');
    equal(row.usedPerDay, null, 'null — not a rate of zero');
    equal(row.daysOfCover, null, 'and never Infinity, which prints as a number');
  } finally { done(); }
});

test('days of cover is available ÷ rate, and it is AVAILABLE again', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Motor', 100);
    await usePart({ partId: id, qty: USAGE_WINDOW_DAYS, reason: 'use_unit' }); // one a day
    await requestPart({ partId: id, qty: 4 });

    const row = find((await reorderReport()).unwatched, 'Motor');
    equal(row.usedPerDay, 1);
    equal(row.available, 100 - USAGE_WINDOW_DAYS - 4);
    equal(row.daysOfCover, 100 - USAGE_WINDOW_DAYS - 4, 'at one a day');
  } finally { done(); }
});

suite('reorder — a suggestion needs BOTH halves measured');
test('no usage, or no lead time, means no suggestion', () => {
  equal(suggestReorderPoint({ perDay: null, leadDays: 7 }), null, 'never used it');
  equal(suggestReorderPoint({ perDay: 0, leadDays: 7 }), null);
  equal(suggestReorderPoint({ perDay: 2, leadDays: null }), null, 'never timed a delivery');
  equal(suggestReorderPoint({ perDay: 2, leadDays: undefined }), null);
});

test('with both, it is usage over the lead time plus half again', () => {
  equal(suggestReorderPoint({ perDay: 2, leadDays: 10 }), 30, '2/day × 10 days × 1.5');
  equal(suggestReorderPoint({ perDay: 0.01, leadDays: 5 }), 1, 'never rounds down to nothing');
});

test('the lead time comes from the supplier’s own deliveries, not a guess', async () => {
  const { done } = await fresh();
  try {
    const s = await createSupplier({ name: 'PartsCo' });
    const id = await stocked('Pump', 50);
    await setReorderPoint(id, { point: 5, supplierId: s.id });

    // No order has ever been received from them yet.
    let row = find((await reorderReport()).watched, 'Pump');
    equal(row.leadDays, null, 'nothing delivered yet, so nothing to measure');
    equal(row.suggestedPoint, null, 'and therefore no suggestion');
  } finally { done(); }
});

suite('reorder — how many to buy');
test('a stated quantity is honoured', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Switch', 0);
    await setReorderPoint(id, { point: 3, qty: 25 });
    equal(find((await reorderReport()).below, 'Switch').orderQty, 25);
  } finally { done(); }
});

test('with none stated it refills to TWICE the point, not back to it', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Latch', 2);
    await setReorderPoint(id, { point: 4 });
    // Refilling to 4 would put it straight back on this list; 8 − 2 = 6.
    equal(find((await reorderReport()).below, 'Latch').orderQty, 6);
  } finally { done(); }
});

suite('reorder — it refuses nonsense rather than storing it');
test('a negative point, a zero order quantity, and an unknown part', async () => {
  const { done } = await fresh();
  try {
    const id = await stocked('Gasket', 1);
    await refuses(() => setReorderPoint(id, { point: -1 }), /whole number/i, 'a negative point');
    await refuses(() => setReorderPoint(id, { qty: 0 }), /at least one/i, 'ordering none');
    await refuses(() => setReorderPoint(id, { point: 'soon' }), /whole number/i, 'a point that is a word');
    await refuses(() => setReorderPoint(999999, { point: 1 }), /No such part/i, 'a part that is not there');
  } finally { done(); }
});

suite('reorder — the report survives an empty shelf');
test('no parts at all is zeroes, not a crash', async () => {
  const { done } = await fresh();
  try {
    await ensurePartSchema();
    const r = await reorderReport();
    equal(r.counts.parts, 0);
    equal(r.below.length, 0);
    equal(r.windowDays, USAGE_WINDOW_DAYS);
  } finally { done(); }
});
