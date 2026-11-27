// A change to the sale reaches the delivery stop's items.
// zz- so it runs last, like zz-load-list: modules create their tables once per process.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { ensureJobSchema } from '../lib/jobs.js';
import { stopCargo, syncStopItems } from '../lib/stop-sync.js';
import { cancelInvoiceOrder } from '../lib/orders.js';

suite('stop items follow the sale');

async function seed(client, { status = 'scheduled' } = {}) {
  await ensureJobSchema();
  await client.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kind text; ALTER TABLE order_items ALTER COLUMN sku DROP NOT NULL`);
  const o = (await client.query(
    `INSERT INTO orders (order_number, name, email, total, status, delivery_method, address)
     VALUES ('BB-9001','Pat','p@x.ca',100,'confirmed','delivery','1 Main St') RETURNING id`)).rows[0].id;
  await line(client, o, 'FR-1', 'Fridge (FR-1)');
  await line(client, o, 'ST-1', 'Stove (ST-1)');
  await line(client, o, null, 'Delivery', 'service');
  const j = await stop(client, o, 'RS-9001', status);
  await item(client, j, 'Fridge (FR-1)', 'FR-1');
  await item(client, j, 'Stove (ST-1)', 'ST-1');
  await item(client, j, 'Extra hose from the office', null);
  return { o, j };
}
const line = (c, o, sku, title, kind = 'unit', price = 50) =>
  c.query('INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,$3,$4,$5)', [o, sku, title, price, kind]);
const stop = async (c, o, number, status) => (await c.query(
  `INSERT INTO jobs (job_number, type, status, order_id, address, job_date, notes)
   VALUES ($1,'delivery',$2,$3,'1 Main St','2026-12-01','Bargain Bay order BB-9001.') RETURNING id`, [number, status, o])).rows[0].id;
const item = (c, j, description, sku, delivered = null) =>
  c.query('INSERT INTO job_items (job_id, description, sku, delivered) VALUES ($1,$2,$3,$4)', [j, description, sku, delivered]);
const names = async (c, j) => (await c.query('SELECT description FROM job_items WHERE job_id = $1 ORDER BY id', [j])).rows.map((r) => r.description);
const notes = async (c, j) => (await c.query('SELECT notes FROM jobs WHERE id = $1', [j])).rows[0].notes;
const load = (c, j, sku) => c.query(
  `UPDATE job_items i SET loaded_at = now(), loaded_by = 'Dee', loaded_for = j.job_date FROM jobs j WHERE j.id = i.job_id AND i.job_id = $1 AND i.sku = $2`, [j, sku]);
// What every real caller does: read, change the sale, apply the difference.
async function change(o, fn) {
  const before = await stopCargo(o);
  await fn();
  return syncStopItems(o, before);
}

test('an added appliance reaches the stop; ticks and hand-typed lines stay', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await load(client, j, 'FR-1');
    await change(o, async () => { await line(client, o, 'DW-1', 'Dishwasher (DW-1)'); await line(client, o, null, 'Install', 'service'); });
    equal(await names(client, j), ['Fridge (FR-1)', 'Stove (ST-1)', 'Extra hose from the office', 'Dishwasher (DW-1)']);
    assert((await client.query(`SELECT loaded_at FROM job_items WHERE sku = 'FR-1'`)).rows[0].loaded_at);
    // Saving the same sale again changes nothing.
    equal((await change(o, async () => {})).changed, 0);
  } finally { done(); }
});

test('a loaded unit taken off the sale leaves the list and the crew is told', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await load(client, j, 'ST-1');
    await change(o, () => client.query(`DELETE FROM order_items WHERE order_id = $1 AND sku = 'ST-1'`, [o]));
    equal(await names(client, j), ['Fridge (FR-1)', 'Extra hose from the office']);
    assert((await notes(client, j)).startsWith('[TAKE OFF THE VAN — no longer on this sale: Stove (ST-1)]'));
    // Put back: the instruction is withdrawn.
    await change(o, () => line(client, o, 'ST-1', 'Stove (ST-1)'));
    equal(await notes(client, j), 'Bargain Bay order BB-9001.');
    equal((await names(client, j)).length, 3);
  } finally { done(); }
});

test('a swapped unit stays on the stop it came off', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    const second = await stop(client, o, 'RS-9002', 'scheduled');
    await client.query(`UPDATE job_items SET job_id = $1 WHERE sku = 'ST-1'`, [second]);
    await change(o, () => client.query(`UPDATE order_items SET sku = 'ST-2', title = 'Stove (ST-2)' WHERE sku = 'ST-1'`));
    equal(await names(client, second), ['Stove (ST-2)']);
    equal((await names(client, j)).length, 2);
    equal(await notes(client, second), 'Bargain Bay order BB-9001.');   // never loaded: nothing to say
  } finally { done(); }
});

test('a finished stop is never touched, and a unit on it is not added again', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client, { status: 'done' });
    const next = await stop(client, o, 'RS-9002', 'scheduled');
    await change(o, async () => {
      await client.query(`DELETE FROM order_items WHERE order_id = $1 AND sku = 'ST-1'`, [o]);
      await line(client, o, 'DW-1', 'Dishwasher (DW-1)');
    });
    equal((await names(client, j)).length, 3);
    equal(await names(client, next), ['Dishwasher (DW-1)']);
  } finally { done(); }
});

test('cancelling the sale empties the open stop and says not to deliver; reopening restores it', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await cancelInvoiceOrder(o);
    equal(await names(client, j), ['Extra hose from the office']);
    assert((await notes(client, j)).includes('SALE CANCELLED'));
    await change(o, () => client.query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [o]));
    equal((await names(client, j)).length, 3);
    equal(await notes(client, j), 'Bargain Bay order BB-9001.');
  } finally { done(); }
});

test('a refund adjustment line is not cargo, and a return pickup is left alone', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await change(o, () => client.query(`INSERT INTO order_items (order_id, sku, title, price) VALUES ($1, null, 'Restocking fee (20%)', 10)`, [o]));
    equal((await names(client, j)).length, 3);
    await client.query(`UPDATE jobs SET services = '{return_pickup}' WHERE id = $1`, [j]);
    await change(o, () => client.query(`DELETE FROM order_items WHERE order_id = $1 AND sku = 'ST-1'`, [o]));
    equal((await names(client, j)).length, 3);
  } finally { done(); }
});

test('a typed line picked from stock replaces the typed one without any instruction', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await line(client, o, null, 'LG dryer');
    await item(client, j, 'LG dryer', null);
    await change(o, () => client.query(`UPDATE order_items SET sku = 'DR-1', title = 'LG dryer (DR-1)' WHERE title = 'LG dryer'`));
    equal((await names(client, j)).slice(-1), ['LG dryer (DR-1)']);
    equal((await names(client, j)).length, 4);
    equal(await notes(client, j), 'Bargain Bay order BB-9001.');
  } finally { done(); }
});
