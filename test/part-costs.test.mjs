// lib/part-costs.js — parts bought for a unit flow into its cost, safely.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';

// A fake tracker: Total Cost = product + parts, as the sheet's formula does.
function fakeTracker(rows) {
  const t = rows.map((r, i) => ({ row: i + 4, ...r }));
  const recalc = (r) => { r.totalCost = String((Number(r.cost) || 0) + (Number(String(r.partsCost || '').replace(/[^0-9.]/g, '')) || 0)); };
  t.forEach((r) => { if (!r.totalCost) recalc(r); });
  return {
    rows: t,
    deps: {
      read: async () => t.map((r) => ({ ...r })),
      write: async (cells) => { for (const c of cells) { const r = t.find((x) => x.row === c.row); r[c.field] = String(c.value); recalc(r); } return { written: cells.length }; }
    }
  };
}
const setup = async (db) => {
  await db.client.query('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
  await db.client.query('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
  await db.client.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
};
const sumRows = (db) => db.client.query("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*)::int AS c FROM unit_part_costs WHERE voided_at IS NULL").then((r) => ({ s: Number(r.rows[0].s), c: r.rows[0].c }));

suite('unit part costs');

test('adding parts writes the ABSOLUTE sum to the tracker Parts Cost cell; Total Cost follows', async () => {
  const db = await withTestDb();
  try {
    const { addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'A1', cost: '100', partsCost: '', totalCost: '' }]);
    const r1 = await addPartCost({ sku: 'a1', partName: 'Ice maker', amount: '45.5' }, 'owner@x.ca', tr.deps);
    equal(r1.partsTotal, 45.5); equal(tr.rows[0].partsCost, '45.5'); equal(r1.totalCost, 145.5);
    const r2 = await addPartCost({ sku: 'A1', partName: 'Board', supplier: 'Marcone', amount: 80 }, 'owner@x.ca', tr.deps);
    equal(r2.partsTotal, 125.5); equal(tr.rows[0].partsCost, '125.5'); equal(r2.totalCost, 225.5);
  } finally { db.done(); }
});

test('a Parts Cost typed by hand on the tracker is never overwritten silently; adopting keeps it', async () => {
  const db = await withTestDb();
  try {
    const { addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'B1', cost: '100', partsCost: '$80.00', totalCost: '180' }]);
    let err = null;
    try { await addPartCost({ sku: 'B1', partName: 'Board', amount: 20 }, 'o', tr.deps); } catch (e) { err = e; }
    assert(err && err.needsAdopt, 'should refuse and offer to adopt');
    equal((await sumRows(db)).c, 0);                 // nothing saved
    equal(tr.rows[0].partsCost, '$80.00');           // tracker untouched
    const r = await addPartCost({ sku: 'B1', partName: 'Board', amount: 20, adoptExisting: true }, 'o', tr.deps);
    equal(r.partsTotal, 100); equal(tr.rows[0].partsCost, '100');
    const lines = await db.client.query("SELECT source, amount FROM unit_part_costs ORDER BY id");
    equal(lines.rows.map((x) => [x.source, Number(x.amount)]), [['tracker', 80], ['admin', 20]]);
  } finally { db.done(); }
});

test('a refused tracker write saves nothing', async () => {
  const db = await withTestDb();
  try {
    const { addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'C1', cost: '100', partsCost: '', totalCost: '' }]);
    const deps = { read: tr.deps.read, write: async () => { throw new Error('tracker is read-only here'); } };
    let msg = ''; try { await addPartCost({ sku: 'C1', partName: 'x', amount: 10 }, 'o', deps); } catch (e) { msg = e.message; }
    assert(/read-only/.test(msg)); equal((await sumRows(db)).c, 0);
  } finally { db.done(); }
});

test('voiding recalculates the sum on the tracker; the row is kept, not deleted', async () => {
  const db = await withTestDb();
  try {
    const { addPartCost, voidPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'D1', cost: '100', partsCost: '', totalCost: '' }]);
    await addPartCost({ sku: 'D1', partName: 'A', amount: 30 }, 'o', tr.deps);
    await addPartCost({ sku: 'D1', partName: 'B', amount: 20 }, 'o', tr.deps);
    const id = (await db.client.query("SELECT id FROM unit_part_costs WHERE part_name = 'A'")).rows[0].id;
    const r = await voidPartCost(id, 'o', { deps: tr.deps });
    equal(r.partsTotal, 20); equal(tr.rows[0].partsCost, '20');
    equal((await db.client.query('SELECT COUNT(*)::int AS c FROM unit_part_costs')).rows[0].c, 2);
    let msg = ''; try { await voidPartCost(id, 'o', { deps: tr.deps }); } catch (e) { msg = e.message; }
    assert(/already voided/.test(msg));
  } finally { db.done(); }
});

test('the new Total Cost reaches products.cost and snapshot lines; a typed line cost is left alone', async () => {
  const db = await withTestDb();
  try {
    await setup(db);
    const q = (s, p) => db.client.query(s, p);
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('E1','LG','M','Fridge',1000,100,true)");
    const inv = (await q("INSERT INTO invoices (number, email, status, subtotal, total) VALUES ('INV-1','a@b.ca','paid',100,113) RETURNING id")).rows[0].id;
    await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, cost) VALUES ($1,'snapshot','E1',100,'unit',100),($1,'typed','E1',100,'unit',77)", [inv]);
    const { addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'E1', cost: '100', partsCost: '', totalCost: '' }]);
    const r = await addPartCost({ sku: 'E1', partName: 'Board', amount: 60 }, 'o', tr.deps);
    equal(r.totalCost, 160); equal(r.linesUpdated, 1);
    equal(Number((await q("SELECT cost FROM products WHERE sku = 'E1'")).rows[0].cost), 160);
    const lines = (await q("SELECT description, cost FROM invoice_items ORDER BY id")).rows;
    equal(lines.map((l) => [l.description, Number(l.cost)]), [['snapshot', 160], ['typed', 77]]);
  } finally { db.done(); }
});

test('validation: needs a unit on the tracker, a part name, a positive amount, and no future date', async () => {
  const db = await withTestDb();
  try {
    const { addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'F1', cost: '100', partsCost: '', totalCost: '' }]);
    const bad = async (b) => { try { await addPartCost(b, 'o', tr.deps); return ''; } catch (e) { return e.message; } };
    assert(/not on the tracker/.test(await bad({ sku: 'NOPE', partName: 'x', amount: 5 })));
    assert(/what the part is/.test(await bad({ sku: 'F1', partName: ' ', amount: 5 })));
    assert(/above zero/.test(await bad({ sku: 'F1', partName: 'x', amount: 0 })));
    assert(/future/.test(await bad({ sku: 'F1', partName: 'x', amount: 5, orderedOn: '2999-01-01' })));
    equal((await sumRows(db)).c, 0);
  } finally { db.done(); }
});

suite('part costs posted by RS Ops');

test('upsert is idempotent per part; a new price UPDATES; void removes it from the tracker sum', async () => {
  const db = await withTestDb();
  try {
    const { upsertRsopsPartCost, voidRsopsPartCost, addPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'R1', cost: '100', partsCost: '', totalCost: '' }]);
    const post = (amount, extra = {}) => upsertRsopsPartCost({ unitId: 'R1', partKey: 'p1', partName: 'Ice maker', amount, by: 'Tech (RS Ops)', ...extra }, tr.deps);
    let writes = 0; const write = tr.deps.write; tr.deps.write = async (c) => { writes += 1; return write(c); };
    const a = await post(45); equal(a.amount, 45); equal(tr.rows[0].partsCost, '45'); equal(writes, 1);
    const again = await post(45); equal(again.unchanged, true); equal(writes, 1);          // no second write
    equal((await sumRows(db)).c, 1);
    const up = await post(60); equal(up.updated, true); equal(tr.rows[0].partsCost, '60'); // price changed
    equal((await sumRows(db)).c, 1);
    await addPartCost({ sku: 'R1', partName: 'Door seal', amount: 15 }, 'owner', tr.deps);   // typed here as well
    equal(tr.rows[0].partsCost, '75');
    const v = await voidRsopsPartCost({ unitId: 'R1', partKey: 'p1', by: 'Tech (RS Ops)' }, tr.deps);
    equal(v.voided, true); equal(tr.rows[0].partsCost, '15');
    equal((await voidRsopsPartCost({ unitId: 'R1', partKey: 'p1' }, tr.deps)).unchanged, true);
    const again2 = await post(60); equal(again2.updated, false); equal(tr.rows[0].partsCost, '75');   // re-ordered: a new row
  } finally { db.done(); }
});

test('RS Ops never adopts a hand-typed Parts Cost: it is refused with the reason, nothing saved', async () => {
  const db = await withTestDb();
  try {
    const { upsertRsopsPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'R2', cost: '100', partsCost: '$80.00', totalCost: '180' }]);
    let err = null; try { await upsertRsopsPartCost({ unitId: 'R2', partKey: 'p1', partName: 'x', amount: 20 }, tr.deps); } catch (e) { err = e; }
    assert(err && /already shows \$80\.00/.test(err.message)); equal((await sumRows(db)).c, 0); equal(tr.rows[0].partsCost, '$80.00');
  } finally { db.done(); }
});

test('RS Ops posts are validated: a unit and part key, a name, a positive price', async () => {
  const db = await withTestDb();
  try {
    const { upsertRsopsPartCost } = await import('../lib/part-costs.js');
    const tr = fakeTracker([{ sku: 'R3', cost: '100', partsCost: '', totalCost: '' }]);
    const bad = async (b) => { try { await upsertRsopsPartCost({ unitId: 'R3', partKey: 'p', partName: 'x', amount: 5, ...b }, tr.deps); return ''; } catch (e) { return e.message; } };
    assert(/Which unit/.test(await bad({ partKey: '' })));
    assert(/no name/.test(await bad({ partName: '' })));
    assert(/above zero/.test(await bad({ amount: 0 })));
    assert(/not on the tracker/.test(await bad({ unitId: 'NOPE' })));
    equal((await sumRows(db)).c, 0);
  } finally { db.done(); }
});
