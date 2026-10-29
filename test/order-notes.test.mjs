// Internal notes + extras: shared between an order and its stop; extras stay open until billed.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { addNote, listNotes, openExtras, setBilled, noteCountsForJobs } from '../lib/order-notes.js';
import { ensureJobSchema } from '../lib/jobs.js';

suite('lib/order-notes');

test('notes are shared between an order and its stop; extras stay open until billed', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const o = (await client.query(`INSERT INTO orders (order_number, name, email, total) VALUES ('BB-9','A','a@b.c',1) RETURNING id`)).rows[0];
    const j = (await client.query(`INSERT INTO jobs (job_number, type, status, order_id) VALUES ('RS-9','delivery','scheduled',$1) RETURNING id`, [o.id])).rows[0];
    await addNote({ orderId: o.id, body: 'Narrow stairs', by: { email: 's@x' }, role: 'staff' });
    await addNote({ jobId: j.id, kind: 'extra', body: 'Carried up 3 flights', by: { email: 'd@x' }, role: 'driver' });
    equal((await listNotes({ jobId: j.id })).length, 2);
    equal((await listNotes({ orderId: o.id })).length, 2);
    equal((await noteCountsForJobs([j.id]))[j.id].extras, 1);
    const [ex] = await openExtras();
    equal(ex.orderNumber, 'BB-9');
    await setBilled(ex.id, true, { name: 'Office' });
    equal((await openExtras()).length, 0);
    let threw = false;
    try { await addNote({ jobId: j.id, body: '  ' }); } catch { threw = true; }
    assert(threw, 'blank note refused');
  } finally { done(); }
});
