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
    assert(list[0].portal_url.startsWith(`https://dispatch.rssolutions.ca/client/${c.id}?t=`), 'the link a client gets is on the RS host');
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

test('a client adds a delivery: it lands unscheduled on the board, tagged, and is validated', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const { createClientRequest } = await import('../lib/client-portal.js');
    const a = await upsertClient({ name: 'A Co', contactEmail: 'a@a.ca' });
    const ok = { customerName: 'Pat Lee', phone: '5195550100', address: '1 Main St', city: 'Kitchener',
      items: [{ description: 'LG fridge', qty: 2 }], services: ['delivery_only', 'haul_away', 'bogus'], notes: 'Side door', preferredDate: '2999-01-01' };
    const r = await createClientRequest(a.id, ok);
    const j = (await client.query('SELECT * FROM jobs WHERE id = $1', [r.id])).rows[0];
    equal(j.status, 'unscheduled');
    equal(j.source, 'client_portal');
    equal(j.client_id, a.id);
    equal(j.job_date, null);
    assert(j.notes.includes('Preferred date: 2999-01-01'), 'date kept as a request, not a schedule');
    equal(j.services.join(','), 'delivery_only,haul_away');
    for (const bad of [{ ...ok, customerName: '' }, { ...ok, address: '' }, { ...ok, items: [] }, { ...ok, phone: '' }]) {
      let threw = false;
      try { await createClientRequest(a.id, bad); } catch { threw = true; }
      assert(threw, 'incomplete request refused');
    }
    const mine = await listClientJobs(a.id);
    equal(mine.length, 1);
    equal(mine[0].requestedByClient, true);
  } finally { done(); }
});

test('an invoice line is read back to the stop it billed', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const { jobsForInvoice, takeJobFor } = await import('../lib/client-portal.js');
    const { jobLineDescription } = await import('../lib/invoice-job-line.js');
    const a = await upsertClient({ name: 'A Co' });
    const inv = (await client.query(`INSERT INTO invoices (email, name, status, subtotal, hst, total, number) VALUES ('a@a.ca','A Co','open',85,11.05,96.05,'INV-1') RETURNING id`)).rows[0];
    const j = (await client.query(`INSERT INTO jobs (job_number, type, status, client_id, customer_name, invoice_id, services) VALUES ('RS-5','delivery','done',$1,'Carol Crozier',$2,'{haul_away}') RETURNING id`, [a.id, inv.id])).rows[0];
    const { clientId, byDescription } = await jobsForInvoice(inv.id);
    equal(clientId, a.id);
    const desc = jobLineDescription({ ref: 'RS-5', customer: 'Carol Crozier', services: ['Haul away'] });
    equal(takeJobFor(byDescription, desc), j.id);
    equal(takeJobFor(byDescription, desc), null);
  } finally { done(); }
});

test('a cancelled stop is not shown to the client', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const a = await upsertClient({ name: 'A Co' });
    await client.query(`INSERT INTO jobs (job_number, type, status, client_id, customer_name) VALUES ('RS-C1','delivery','cancelled',$1,'Gone'), ('RS-C2','delivery','scheduled',$1,'Kept')`, [a.id]);
    const jobs = await listClientJobs(a.id);
    equal(jobs.length, 1);
    equal(jobs[0].customerName, 'Kept');
  } finally { done(); }
});

test('the portal password: set by the office, checked, locked out on guessing, and a new one signs everybody out', async () => {
  const { done } = await withTestDb();
  try {
    await ensureJobSchema();
    const auth = await import('../lib/client-portal-auth.js');
    const a = await upsertClient({ name: 'A Co' });
    // fail closed: no password, no entry
    equal(await auth.portalGate(a.id, ''), 'no_password');
    equal((await auth.attemptPortalLogin(a.id, 'whatever', '1.1.1.1')).reason, 'no_password');

    let threw = false;
    try { await auth.setClientPassword(a.id, 'short'); } catch { threw = true; }
    assert(threw, 'a weak password is refused');
    await auth.setClientPassword(a.id, 'Kitchener-2026');
    equal(await auth.portalGate(a.id, ''), 'needs_password');
    assert(!(await listClients())[0].portal_password_hash, 'the hash never leaves in the client list');
    equal((await listClients())[0].portal_password_set, true);

    const bad = await auth.attemptPortalLogin(a.id, 'nope', '2.2.2.2');
    assert(!bad.ok && !bad.locked);
    const good = await auth.attemptPortalLogin(a.id, 'Kitchener-2026', '3.3.3.3');
    assert(good.ok, 'right password signs in');
    equal(await auth.portalGate(a.id, good.cookie.value), 'ok');
    equal(await auth.portalGate(a.id + 1, good.cookie.value), 'no_password', "a cookie is for ONE client");
    equal(await auth.portalGate(a.id, good.cookie.value + 'x'), 'needs_password', 'a tampered cookie fails');

    // five wrong guesses from one address locks that address, even for the right password
    for (let i = 0; i < 5; i++) await auth.attemptPortalLogin(a.id, 'guess' + i, '9.9.9.9');
    const locked = await auth.attemptPortalLogin(a.id, 'Kitchener-2026', '9.9.9.9');
    assert(locked.locked, 'locked after repeated wrong passwords');

    // changing the password invalidates every existing cookie
    await auth.setClientPassword(a.id, 'Another-pass-1');
    equal(await auth.portalGate(a.id, good.cookie.value), 'needs_password');
    await auth.clearClientPassword(a.id);
    equal(await auth.portalGate(a.id, good.cookie.value), 'no_password');
  } finally { done(); }
});

test('invoices billed to a client are listed with what is owing', async () => {
  const { client, done } = await withTestDb();
  try {
    await ensureJobSchema();
    const { listClientInvoices } = await import('../lib/client-portal.js');
    const a = await upsertClient({ name: 'A Co' });
    const o = (await client.query(`INSERT INTO invoices (email, name, status, subtotal, hst, total, number, due_date) VALUES ('a@a.ca','A Co','open',100,13,113,'INV-1','2000-01-01') RETURNING id`)).rows[0];
    const p = (await client.query(`INSERT INTO invoices (email, name, status, subtotal, hst, total, number) VALUES ('a@a.ca','A Co','paid',200,26,226,'INV-2') RETURNING id`)).rows[0];
    const v = (await client.query(`INSERT INTO invoices (email, name, status, subtotal, hst, total, number) VALUES ('a@a.ca','A Co','void',5,0,5,'INV-3') RETURNING id`)).rows[0];
    for (const [n, inv] of [['RS-1', o.id], ['RS-2', p.id], ['RS-3', v.id]]) {
      await client.query(`INSERT INTO jobs (job_number, type, status, client_id, invoice_id) VALUES ($1,'delivery','done',$2,$3)`, [n, a.id, inv]);
    }
    const list = await listClientInvoices(a.id);
    equal(list.length, 2, 'void invoices are not shown');
    const open = list.find((i) => i.number === 'INV-1');
    equal(open.owing, 113);
    assert(open.overdue, 'past due and unpaid is overdue');
    equal(list.find((i) => i.number === 'INV-2').owing, 0);
  } finally { done(); }
});
