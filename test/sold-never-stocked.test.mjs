// addSoldUnits — a sale of something that was never in stock gets a unit and a cost in one step.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { addSoldUnits, guessCategory } from '../lib/stock-reconcile.js';
import { makeIn } from '../lib/make.js';

function fakeTracker(rows = []) {
  const t = rows.map((r, i) => ({ row: i + 4, ...r }));
  const log = { appends: 0, writes: [] };
  return {
    rows: t, log,
    deps: {
      read: async () => t.map((r) => ({ ...r })),
      append: async (units) => { log.appends++; for (const u of units) t.push({ row: t.length + 4, ...u }); },
      write: async (cells) => { log.writes.push(...cells); for (const c of cells) t.find((x) => x.row === c.row)[c.field] = c.value; }
    }
  };
}

const LINE = '2x LG 30" Electric Stove LREL6321S';
async function seed(db, { status = 'paid', amount = 1000, description = LINE } = {}) {
  const q = (s, p) => db.client.query(s, p);
  for (const t of ['invoice_items', 'order_items']) {
    await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS kind text`);
    await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS cost numeric(10,2)`);
  }
  await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS typed_amount numeric(10,2)');
  await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_at timestamptz');
  await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warranty_months int');
  await q('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text');
  await q('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int');
  const o = (await q("INSERT INTO orders (order_number, email, status, subtotal, hst, total) VALUES ('BB-1','a@b.ca','delivered',$1,0,$1) RETURNING id", [amount])).rows[0].id;
  await q('INSERT INTO order_items (order_id, title, price) VALUES ($1,$2,$3)', [o, description, amount]);
  const i = (await q("INSERT INTO invoices (number, email, status, subtotal, hst, total, order_id, created_at) VALUES ('INV-1','a@b.ca',$2,$1,0,$1,$3,'2026-09-10T16:00:00Z') RETURNING id", [amount, status, o])).rows[0].id;
  const line = (await q('INSERT INTO invoice_items (invoice_id, description, amount) VALUES ($1,$2,$3) RETURNING id', [i, description, amount])).rows[0].id;
  return { line };
}
const rows = async (db, sql) => (await db.client.query(sql)).rows;
const sold = async (db, table) => (await rows(db, `SELECT sku, cost FROM ${table} ORDER BY sku`)).map((r) => [r.sku, r.cost == null ? null : Number(r.cost)]);

suite('sold without a stock unit: express add');

test('reads the brand and category off a typed line', async () => {
  equal(makeIn(LINE), 'LG'); equal(makeIn('Stainless fridge'), '');
  equal(guessCategory(LINE), 'Range'); equal(guessCategory('Over the range microwave'), 'Microwave');
  equal(guessCategory('Washer dryer set', 0, 2), 'Washer'); equal(guessCategory('Washer dryer set', 1, 2), 'Dryer');
});

test('one save adds the units as Sold on the sale date, splits the line and costs both sides', async () => {
  const db = await withTestDb();
  try {
    const { line } = await seed(db);
    const tr = fakeTracker();
    const r = await addSoldUnits([{ itemId: line, cost: '600.01', units: 2, model: 'LREL6321S' }], { by: 'x@y.ca', deps: tr.deps });
    equal(r.refused, []); equal(r.saved[0].orderLineFound, true);
    const a = `BI-L${line}-1`, b = `BI-L${line}-2`;
    equal(r.saved[0].skus, [a, b]);
    equal(tr.rows.map((u) => [u.sku, u.cost, u.status, u.soldPrice, u.dateSold, u.invoice, u.category, u.make]),
      [[a, 300, 'Sold', 500, '2026-09-10', 'NEEDS INVOICE', 'Range', 'LG'], [b, 300.01, 'Sold', 500, '2026-09-10', 'NEEDS INVOICE', 'Range', 'LG']]);
    equal(await sold(db, 'invoice_items'), [[a, 300], [b, 300.01]]);
    equal(await sold(db, 'order_items'), [[a, 300], [b, 300.01]]);
    const again = await addSoldUnits([{ itemId: line, cost: '600' }], { deps: tr.deps });
    equal(again.saved, []); assert(/already linked/.test(again.refused[0].reason)); equal(tr.log.appends, 1);
  } finally { db.done(); }
});

test('a model we hold unsold is refused until confirmed', async () => {
  const db = await withTestDb();
  try {
    const { line } = await seed(db);
    const tr = fakeTracker([{ sku: 'IN-1', model: 'LREL6321S', status: 'Tested Working', dateReceived: '2026-09-01' }]);
    const r = await addSoldUnits([{ itemId: line, cost: 400 }], { deps: tr.deps });
    equal(r.saved, []); equal(r.refused[0].duplicate, true); equal(tr.log.appends, 0);
    const ok = await addSoldUnits([{ itemId: line, cost: 400, confirmNew: true }], { deps: tr.deps });
    equal(ok.saved.length, 1);
  } finally { db.done(); }
});

test('an unpaid invoice does not mark the new unit Sold', async () => {
  const db = await withTestDb();
  try {
    const { line } = await seed(db, { status: 'open' });
    const tr = fakeTracker();
    const r = await addSoldUnits([{ itemId: line, cost: 400 }], { deps: tr.deps });
    equal(r.saved[0].stock, 'held'); equal(tr.rows[0].status, null); equal(tr.rows[0].dateSold, null);
  } finally { db.done(); }
});

test('a blank or zero cost writes nothing', async () => {
  const db = await withTestDb();
  try {
    const { line } = await seed(db);
    const tr = fakeTracker();
    for (const cost of ['', '0', 'abc']) equal((await addSoldUnits([{ itemId: line, cost }], { deps: tr.deps })).refused.length, 1);
    equal(tr.log.appends, 0);
  } finally { db.done(); }
});

test('a retry after a failed link reuses the same tracker row and corrects its cost', async () => {
  const db = await withTestDb();
  try {
    const { line } = await seed(db);
    const tr = fakeTracker([{ sku: `BI-L${0}`, lot: 'x' }]);
    tr.rows.push({ row: 5, sku: `BI-L${line}-1`, lot: 'BI-SOLD', status: 'Sold', cost: 111, model: '' });
    const r = await addSoldUnits([{ itemId: line, cost: 400 }], { deps: tr.deps });
    equal(r.saved.length, 1); equal(tr.log.appends, 0);
    equal(tr.log.writes, [{ row: 5, field: 'cost', value: 400 }]);
    equal(await sold(db, 'order_items'), [[`BI-L${line}-1`, 400]]);
  } finally { db.done(); }
});
