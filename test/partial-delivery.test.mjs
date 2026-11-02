// Partial delivery: a closed stop with an item left on the van keeps the order open and gets a follow-up stop.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { ensureJobSchema, recordJobItemDelivery, createPartialFollowUp, recordPartialDelivery, importOneBargainBayOrder } from '../lib/jobs.js';

suite('partial delivery');

async function seed(client, { podItems } = {}) {
  await ensureJobSchema();
  const o = (await client.query(
    `INSERT INTO orders (order_number, name, email, total, status, delivery_method, address, city, postal)
     VALUES ('BB-1251','Pat','p@x.ca',100,'out_for_delivery','delivery','1 Main St','Pickering','L1W1A1') RETURNING id`)).rows[0];
  await client.query(`INSERT INTO order_items (order_id, sku, title, price) VALUES ($1,'FR-1','Fridge',50),($1,'ST-1','Stove',50)`, [o.id]);
  const j = (await client.query(
    `INSERT INTO jobs (job_number, type, status, order_id, address, customer_name, pod_form)
     VALUES ('RS-5001','delivery','done',$1,'1 Main St','Pat',$2::jsonb) RETURNING id`,
    [o.id, podItems ? JSON.stringify({ items: podItems }) : null])).rows[0];
  await client.query(`INSERT INTO job_items (job_id, description, sku) VALUES ($1,'Fridge','FR-1'),($1,'Stove','ST-1')`, [j.id]);
  return { o, j };
}

test('driver unticks the stove: it is recorded undelivered and gets its own stop', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client, { podItems: [
      { description: 'Fridge', sku: 'FR-1', delivered: true },
      { description: 'Stove', sku: 'ST-1', delivered: false }] });
    const r = await recordJobItemDelivery(j.id);
    equal(r.delivered.length, 1); equal(r.remaining.length, 1); equal(r.remaining[0].sku, 'ST-1');
    const f = await createPartialFollowUp(j.id, { by: { name: 't' } });
    assert(f.jobNumber, 'follow-up created');
    const again = await createPartialFollowUp(j.id, {});
    equal(again.jobNumber, f.jobNumber); // idempotent
    const items = (await client.query('SELECT sku FROM job_items WHERE job_id = $1', [f.id])).rows;
    equal(items.length, 1); equal(items[0].sku, 'ST-1');
    // The finished partial stop no longer blocks putting the order on the board again.
    const board = await importOneBargainBayOrder('BB-1251', {}).catch((e) => e.message);
    assert(String(board).includes(f.jobNumber), 'live follow-up is what the board sees');
    void o;
  } finally { done(); }
});

test('office corrects a stop closed as fully delivered', async () => {
  const { client, done } = await withTestDb();
  try {
    const { o, j } = await seed(client);
    await client.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [o.id]);
    const ids = (await client.query(`SELECT id FROM job_items WHERE job_id = $1 AND sku = 'ST-1'`, [j.id])).rows.map((r) => r.id);
    const r = await recordPartialDelivery(j.id, { remainingItemIds: ids, jobDate: '2026-11-02' }, { name: 'Office' });
    assert(r.followUp.jobNumber);
    equal((await client.query('SELECT status FROM orders WHERE id = $1', [o.id])).rows[0].status, 'out_for_delivery');
    const f = (await client.query('SELECT job_date::text AS d, status FROM jobs WHERE id = $1', [r.followUp.id])).rows[0];
    equal(f.d, '2026-11-02'); equal(f.status, 'scheduled');
  } finally { done(); }
});
