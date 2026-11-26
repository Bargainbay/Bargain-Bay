// lib/unit-cost.js — a cost typed on Stock gaps reaches the tracker, the site and the sales.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { setWaitingCosts, typedCost, totalAfter } from '../lib/unit-cost.js';

function fakeTracker(rows) {
  const t = rows.map((r, i) => ({ row: i + 4, ...r }));
  const writes = [];
  return {
    rows: t, writes,
    deps: {
      read: async () => t.map((r) => ({ ...r })),
      write: async (cells) => { writes.push(...cells); for (const c of cells) t.find((x) => x.row === c.row)[c.field] = String(c.value); }
    }
  };
}

async function seed(db) {
  const q = (s, p) => db.client.query(s, p);
  await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
  await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
  await q('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kind text');
  await q('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
  await q("INSERT INTO products (sku, title, price, cost, active) VALUES ('W1','Washer',500,NULL,false)");
  await q("INSERT INTO salvage_units (sku, cost) VALUES ('W1',0)");
  const o = (await q("INSERT INTO orders (order_number, email, status, subtotal, hst, total) VALUES ('BB-1','a@b.ca','delivered',500,65,565) RETURNING id")).rows[0].id;
  for (const c of [null, 0, 77]) await q('INSERT INTO order_items (order_id, sku, title, price, cost) VALUES ($1,$2,$3,500,$4)', [o, 'W1', 'Washer', c]);
  const i = (await q("INSERT INTO invoices (number, email, status, subtotal, hst, total) VALUES ('INV-1','a@b.ca','paid',500,65,565) RETURNING id")).rows[0].id;
  for (const c of [null, 77]) await q('INSERT INTO invoice_items (invoice_id, sku, description, amount, cost) VALUES ($1,$2,$3,500,$4)', [i, 'W1', 'Washer', c]);
}
const costs = async (db, table) => (await db.client.query(`SELECT cost FROM ${table} ORDER BY 1 NULLS FIRST`)).rows.map((r) => (r.cost == null ? null : Number(r.cost)));

suite('unit cost typed on Stock gaps');

test('reads typed figures strictly; blank and words are not zero', async () => {
  equal(typedCost('$1,250.50'), 1250.5); equal(typedCost('0'), 0);
  equal(typedCost(''), null); equal(typedCost('abc'), null); equal(typedCost('-5'), null); equal(typedCost('1e9'), null);
});

test('total keeps parts and labour already on the row', async () => {
  equal(totalAfter({ cost: '', partsCost: '40', totalCost: '' }, 100), 140);
  equal(totalAfter({ cost: '$100.00', totalCost: '$160.00' }, 120), 180);
  equal(totalAfter({ cost: '', totalCost: '$0.00' }, 100), 100);
});

test('one save reaches the tracker, product, salvage and blank/zero sale lines; a typed line is kept; a second save moves them again', async () => {
  const db = await withTestDb();
  try {
    await seed(db);
    const tr = fakeTracker([{ sku: 'W1', invoice: 'NEEDS INVOICE', cost: '', partsCost: '', totalCost: '$0.00' }]);
    const r = await setWaitingCosts([{ sku: 'w1', cost: '100' }], { deps: tr.deps });
    equal(tr.writes, [{ row: 4, field: 'cost', value: 100 }]);
    equal(r.invoiceLines, 1); equal(r.orderLines, 2);
    equal(r.kept, [{ sku: 'W1', invoice: 'INV-1', cost: 77 }]);
    equal(await costs(db, 'products'), [100]);
    equal(await costs(db, 'salvage_units'), [100]);
    equal(await costs(db, 'invoice_items'), [77, 100]);
    equal(await costs(db, 'order_items'), [77, 100, 100]);
    tr.rows[0].totalCost = '$100.00';
    await setWaitingCosts([{ sku: 'W1', cost: '130' }], { deps: tr.deps });
    equal(await costs(db, 'invoice_items'), [77, 130]);
    equal(await costs(db, 'order_items'), [77, 130, 130]);
  } finally { db.done(); }
});

test('a unit that is not waiting, or a bad figure, is refused and nothing is written', async () => {
  const db = await withTestDb();
  try {
    await seed(db);
    const tr = fakeTracker([{ sku: 'W1', invoice: 'PS-INV117000', cost: '50', totalCost: '50' }]);
    const r = await setWaitingCosts([{ sku: 'W1', cost: '100' }, { sku: 'ZZ', cost: 'x' }], { deps: tr.deps });
    equal(r.saved, []); equal(r.refused.length, 2); equal(tr.writes, []);
    equal(await costs(db, 'products'), [null]);
  } finally { db.done(); }
});

test('a refused tracker write saves nothing', async () => {
  const db = await withTestDb();
  try {
    await seed(db);
    const tr = fakeTracker([{ sku: 'W1', invoice: 'NEEDS INVOICE', cost: '', totalCost: '' }]);
    let msg = '';
    try { await setWaitingCosts([{ sku: 'W1', cost: '100' }], { deps: { read: tr.deps.read, write: async () => { throw new Error('read-only'); } } }); }
    catch (e) { msg = e.message; }
    assert(/read-only/.test(msg), msg);
    equal(await costs(db, 'products'), [null]);
    equal(await costs(db, 'order_items'), [null, 0, 77]);
  } finally { db.done(); }
});

test('a unit already parted out has the new cost split over its parts', async () => {
  const db = await withTestDb();
  try {
    await seed(db);
    await db.client.query("UPDATE salvage_units SET status = 'disposed', disposal = 'parted_out'");
    const p = (await db.client.query("INSERT INTO parts (name) VALUES ('Board') RETURNING id")).rows[0].id;
    for (const v of [30, 10]) await db.client.query("INSERT INTO part_moves (part_id, qty, reason, ref, est_value, cost) VALUES ($1,1,'harvest','W1',$2,0)", [p, v]);
    const tr = fakeTracker([{ sku: 'W1', invoice: 'NEEDS INVOICE', cost: '', totalCost: '' }]);
    await setWaitingCosts([{ sku: 'W1', cost: '100' }], { deps: tr.deps });
    equal((await db.client.query('SELECT cost FROM part_moves ORDER BY id')).rows.map((x) => Number(x.cost)), [75, 25]);
  } finally { db.done(); }
});
