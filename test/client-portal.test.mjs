// Client contacts are editable, and the client portal shows a company only its own work.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { upsertClient, listClients, ensureJobSchema, billingSummary } from '../lib/jobs.js';
import {
  clientPortalPath, verifyClientToken, listClientJobs, getClientJob,
  clientPhotoPath, clientSignaturePath, summarize
} from '../lib/client-portal.js';

suite('lib/client-portal');

test('a client can be edited, and an unpassed field is kept', async () => {
  const { done } = await withTestDb();
  try {
    await ensureJobSchema();
    const c = await upsertClient({ name: 'Canadian Discount Appliances' });
    const e = await upsertClient({
      id: c.id, name: c.name, contactName: 'Matt Graham', contactEmail: 'Matt@grahams.ca',
      contactPhone: '(519) 658-3409', notifyOnComplete: true
    });
    equal(e.contact_name, 'Matt Graham');
    equal(e.contact_email, 'Matt@grahams.ca');
    // editing the name only must not blank the flags
    const again = await upsertClient({ id: c.id, name: c.name, contactName: 'Matt Graham', contactEmail: 'Matt@grahams.ca', contactPhone: '(519) 658-3409' });
    equal(again.notify_on_complete, true);
    let threw = false;
    try { await upsertClient({ id: c.id, name: c.name, contactEmail: 'not-an-email' }); } catch { threw = true; }
    assert(threw, 'bad email refused');
    const list = await listClients();
    assert(list[0].portal_path.startsWith(`/client/${c.id}?t=`), 'portal link on the list');
  } finally { done(); }
});

test('billing carries the contact person and phone', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const c = await upsertClient({ name: 'CDA', contactName: 'Matt Graham', contactEmail: 'm@x.ca', contactPhone: '5196583409' });
    await client.query(`INSERT INTO jobs (job_number, type, status, client_id, job_date, charge_amount) VALUES ('RS-1','delivery','done',$1,CURRENT_DATE,100)`, [c.id]);
    const s = await billingSummary({ from: '2000-01-01', to: '2999-01-01' });
    equal(s.clients[0].contactName, 'Matt Graham');
    equal(s.clients[0].contactPhone, '5196583409');
  } finally { done(); }
});

test('the portal is scoped to the client the token proves', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const a = await upsertClient({ name: 'A Co' });
    const b = await upsertClient({ name: 'B Co' });
    const ja = (await client.query(
      `INSERT INTO jobs (job_number, type, status, client_id, customer_name, time_in, time_out, pay_amount, signature_path, pod_form)
       VALUES ('RS-A','delivery','done',$1,'Ann', '2026-11-02T14:00:00Z','2026-11-02T14:45:00Z', 55, 'sig/a.png', '{"productDamageFree":"yes"}') RETURNING id`, [a.id])).rows[0];
    const jb = (await client.query(`INSERT INTO jobs (job_number, type, status, client_id, customer_name) VALUES ('RS-B','delivery','done',$1,'Bob') RETURNING id`, [b.id])).rows[0];
    const pa = (await client.query(`INSERT INTO job_photos (job_id, pathname) VALUES ($1,'photos/a1.jpg') RETURNING id`, [ja.id])).rows[0];
    const pb = (await client.query(`INSERT INTO job_photos (job_id, pathname) VALUES ($1,'photos/b1.jpg') RETURNING id`, [jb.id])).rows[0];

    const tokA = clientPortalPath(a.id).split('t=')[1];
    assert(verifyClientToken(a.id, tokA), 'own token verifies');
    assert(!verifyClientToken(b.id, tokA), "A's token does not open B");
    assert(!verifyClientToken(a.id, ''), 'no token refused');

    const jobs = await listClientJobs(a.id);
    equal(jobs.length, 1);
    equal(jobs[0].minutesOnSite, 45);
    assert(!('payAmount' in jobs[0]) && !JSON.stringify(jobs[0]).includes('55'), 'driver pay never leaves');
    equal(await getClientJob(a.id, jb.id), null, "cannot open B's stop through A");
    equal(await clientPhotoPath(a.id, pb.id), null, "cannot read B's photo through A");
    equal(await clientPhotoPath(a.id, pa.id), 'photos/a1.jpg');
    equal(await clientSignaturePath(b.id, ja.id), null);
    equal(await clientSignaturePath(a.id, ja.id), 'sig/a.png');
    equal(summarize(jobs).withPod, 1);
  } finally { done(); }
});
