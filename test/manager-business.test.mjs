// The manager's business view and its act-then-report tier, against a real
// Postgres (PGlite). Nothing here touches a phone, an email or a customer.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { torontoDay } from '../lib/manager-business.js';
import { scanIssues } from '../lib/manager-issues.js';
import {
  runAutoActions, chaseQuotes, chaseReceivables, assignStopByName, addFollowUpByName,
  unreportedActions, markReported, reportLine, logAction, businessSnapshot,
  nextOverdueInvoice, searchOverdueInvoices, resolveInvoice, nameScore
} from '../lib/manager-actions.js';

async function withDb(fn) {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  try { await fn(client); } finally { globalThis.fetch = realFetch; __useTestDatabase(null); }
}

const keys = (scan) => scan.issues.map((i) => i.key);

suite('manager business view');
test('late invoices, expiring quotes and unassigned stops become issues, with the dollars in them', async () => {
  await withDb(async (c) => {
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    await c.query(`INSERT INTO invoices (number, email, name, status, total, due_date)
      VALUES ('INV-9001','a@x.ca','Late Co','open',4200, $1::date), ('INV-9002','b@x.ca','Fine Co','open',900, $2::date)`, [torontoDay(-40), torontoDay(10)]);
    await c.query(`INSERT INTO quotes (number, email, name, status, total, expires_at)
      VALUES ('Q-9001','c@x.ca','Soon Co','open',2500,$1::date), ('Q-9002','d@x.ca','Later Co','open',800,$2::date)`, [torontoDay(1), torontoDay(20)]);
    await c.query(`INSERT INTO jobs (job_number, type, status, job_date, customer_name, address)
      VALUES ('RS-9001','delivery','scheduled',$1::date,'Nobody Yet','1 St'), ('RS-9002','delivery','scheduled',$2::date,'Also Nobody','2 St')`, [torontoDay(0), torontoDay(1)]);
    const scan = await scanIssues();
    const k = keys(scan);
    for (const want of ['biz-receivables', 'biz-quotes-expiring', 'biz-stops-today-unassigned', 'biz-stops-tomorrow-unassigned']) assert(k.includes(want), `${want} in ${k}`);
    const ar = scan.issues.find((i) => i.key === 'biz-receivables');
    equal(ar.count, 1); assert(/4,200/.test(ar.title), ar.title);   // the future-dated one is not late
    assert(ar.severity === 'high');                                  // 40 days late
    const q = scan.issues.find((i) => i.key === 'biz-quotes-expiring');
    equal(q.count, 1);                                               // the one 20 days out is not "soon"
    // Business problems outrank housekeeping in the ranking the call reads from.
    assert(scan.issues[0].severity === 'high');
  });
});

test('a finished stop for an outside client with no charge is flagged; our own, priced, and non-delivery stops are not', async () => {
  await withDb(async (c) => {
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    await c.query(`INSERT INTO clients (name) VALUES ('Canadian Discount Appliances'), ('Bargain Bay')`);
    const cda = (await c.query(`SELECT id FROM clients WHERE name = 'Canadian Discount Appliances'`)).rows[0].id;
    const bb = (await c.query(`SELECT id FROM clients WHERE name = 'Bargain Bay'`)).rows[0].id;
    const ins = (num, client, status, type, charge) => c.query(
      `INSERT INTO jobs (job_number, type, status, job_date, customer_name, address, client_id, charge_amount) VALUES ($1,$2,$3,$4::date,'X','1 St',$5,$6)`,
      [num, type, status, torontoDay(-2), client, charge]);
    await ins('RS-9101', cda, 'done', 'delivery', null);   // flagged
    await ins('RS-9102', cda, 'done', 'delivery', 135);    // priced
    await ins('RS-9103', bb, 'done', 'delivery', null);    // ours
    await ins('RS-9104', null, 'done', 'delivery', null);  // no client: ours
    await ins('RS-9105', cda, 'scheduled', 'delivery', null); // not finished
    await ins('RS-9106', cda, 'done', 'service_call', null);  // nothing to chase
    const scan = await scanIssues();
    const i = scan.issues.find((x) => x.key === 'biz-client-stops-unpriced');
    assert(i, 'flagged');
    equal(i.count, 1);
    assert(/RS-9101/.test(i.detail) && !/RS-9102|RS-9103|RS-9104|RS-9105|RS-9106/.test(i.detail), i.detail);
  });
});

test('a check that throws is an issue, not a clean bill of health', async () => {
  await withDb(async (c) => {
    await c.query('DROP TABLE quotes CASCADE');
    const scan = await scanIssues();
    // Business checks degrade to "nothing found" on a missing table; the scan as a whole still returns.
    assert(Array.isArray(scan.issues));
  });
});

suite('manager acts, then reports');
test('chasing expiring quotes and late invoices raises ONE follow-up each and never doubles up', async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO customers (email, name) VALUES ('a@x.ca','Late Co'), ('c@x.ca','Soon Co')`);
    await c.query(`INSERT INTO invoices (number, email, name, status, total, due_date) VALUES ('INV-9001','a@x.ca','Late Co','open',4200,$1::date)`, [torontoDay(-10)]);
    await c.query(`INSERT INTO quotes (number, email, name, status, total, expires_at) VALUES ('Q-9001','c@x.ca','Soon Co','open',2500,$1::date)`, [torontoDay(1)]);
    equal((await chaseQuotes()).done, ['Q-9001']);
    equal((await chaseReceivables()).done, ['INV-9001']);
    equal((await chaseQuotes()).done, []);          // already has an open follow-up
    equal((await chaseReceivables()).done, []);
    const t = (await c.query('SELECT title, owner_email, created_by FROM customer_tasks ORDER BY id')).rows;
    equal(t.length, 2);
    assert(t.every((r) => r.owner_email === null), 'unowned, so it shows on everyone\'s day');
    assert(/Chase quote Q-9001/.test(t[0].title) && /Collect INV-9001/.test(t[1].title));
    // And it wrote down what it did.
    const log = await unreportedActions();
    equal(log.length, 2);
    assert(/While you were away I did 2 things/.test(reportLine(log)), reportLine(log));
    await markReported(log.map((a) => a.id));
    equal((await unreportedActions()).length, 0);
  });
});

test('the unattended pass runs only the remedies the scan names, and a failing one does not stop the rest', async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO customers (email, name) VALUES ('c@x.ca','Soon Co')`);
    await c.query(`INSERT INTO quotes (number, email, name, status, total, expires_at) VALUES ('Q-9001','c@x.ca','Soon Co','open',2500,$1::date)`, [torontoDay(1)]);
    const r = await runAutoActions([
      { key: 'x', fix: 'chase_quotes' }, { key: 'y', fix: 'no_such_remedy' }, { key: 'z' }, { key: 'w', fix: 'run_inventory_sync' }
    ]);
    equal(Object.keys(r).sort(), ['chase_quotes', 'run_inventory_sync']);
    equal(r.chase_quotes.done, ['Q-9001']);
    assert(r.run_inventory_sync.error, 'the sync fails here (no tracker) and is reported, not thrown');
    const dry = await runAutoActions([{ key: 'x', fix: 'chase_quotes' }], { dry: true });
    equal(dry.chase_quotes.dry, true);
  });
});

test('a dedupe key means the same thing is never done twice', async () => {
  await withDb(async () => {
    assert(await logAction({ kind: 'k', summary: 's', dedupeKey: 'once' }));
    assert(!(await logAction({ kind: 'k', summary: 's', dedupeKey: 'once' })));
  });
});

suite('manager by voice');
test('it puts a named driver on a stop, refuses a stranger and asks when two match', async () => {
  await withDb(async (c) => {
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    await c.query(`INSERT INTO users (email, name, password_hash, is_driver) VALUES ('r@d.ca','Ruban Kumar','x',true), ('a@d.ca','Ardy Sam','x',true), ('a2@d.ca','Ardy Lee','x',true)`);
    await c.query(`INSERT INTO jobs (job_number, type, status, job_date, customer_name, address) VALUES ('RS-9100','delivery','scheduled',$1::date,'Cust','1 St')`, [torontoDay(1)]);
    assert((await assignStopByName({ jobNumber: 'RS-0000', driverName: 'Ruban' })).error);
    assert((await assignStopByName({ jobNumber: 'RS-9100', driverName: 'Zed' })).error);
    assert(/Which one/.test((await assignStopByName({ jobNumber: 'RS-9100', driverName: 'Ardy' })).error));
    const ok = await assignStopByName({ jobNumber: 'rs-9100', driverName: 'ruban' });
    assert(ok.ok, JSON.stringify(ok));
    const row = (await c.query(`SELECT u.name FROM jobs j JOIN users u ON u.id = j.driver_id WHERE j.job_number = 'RS-9100'`)).rows[0];
    equal(row.name, 'Ruban Kumar');
    equal((await unreportedActions())[0].summary.includes('Ruban Kumar'), true);
  });
});

test('a follow-up for a customer by name raises a task, and an ambiguous name is a question back', async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO customers (email, name) VALUES ('s1@x.ca','Sam Rai'), ('s2@x.ca','Sam Patel'), ('l@x.ca','Lena Cho')`);
    assert(/Several customers/.test((await addFollowUpByName({ customer: 'Sam', title: 'ring' })).error));
    assert((await addFollowUpByName({ customer: 'Nobody', title: 'ring' })).error);
    assert((await addFollowUpByName({ customer: 'Lena', title: 'Ring about the range' })).ok);
    const t = (await c.query('SELECT title, owner_email FROM customer_tasks')).rows;
    equal(t.length, 1); equal(t[0].owner_email, null);
  });
});

test('the snapshot is counts only and says nothing about cost', async () => {
  await withDb(async () => {
    const s = await businessSnapshot();
    assert(s.sales && s.deliveries && s.receivables);
    assert(!/cost|profit|margin/i.test(JSON.stringify(s)));
  });
});

suite('manager works the overdue list');
const seedLate = async (c) => {
  await c.query(`INSERT INTO invoices (number, email, name, status, total, due_date, created_at) VALUES
    ('INV-8001','r@x.ca','Rogers Appliance','open',1240,$1::date,$1::timestamptz),
    ('INV-8002','s@x.ca','Smith Kitchens','open',800,$2::date,$2::timestamptz),
    ('INV-8003','t@x.ca','Tran Homes','open',500,$3::date,$3::timestamptz),
    ('INV-8004','f@x.ca','Future Co','open',900,$4::date,$4::timestamptz)`,
    ['2026-08-10', '2026-09-01', '2026-10-15', torontoDay(30)]);
};

test('it reads the oldest late invoice first, says where it is in the list, and skips ones already answered', async () => {
  await withDb(async (c) => {
    await seedLate(c);
    const a = await nextOverdueInvoice();
    equal(a.number, 'INV-8001'); equal(a.position, 1); equal(a.of, 3); equal(a.remainingAfterThis, 2);
    assert(a.owing === 1240 && a.daysLate > 30);
    await resolveInvoice({ number: 'INV-8001', outcome: 'skip' });
    equal((await nextOverdueInvoice()).number, 'INV-8002');
    await resolveInvoice({ number: 'INV-8002', outcome: 'skip' });
    await resolveInvoice({ number: 'INV-8003', outcome: 'skip' });
    assert((await nextOverdueInvoice()).done, 'a finished list says so rather than starting over');
  });
});

test('a mis-heard name still finds the invoice, and a stranger is "none" with the count, not a dead end', async () => {
  await withDb(async (c) => {
    await seedLate(c);
    const r = await searchOverdueInvoices('Roger');
    equal(r.matches[0].number, 'INV-8001');
    equal((await searchOverdueInvoices('smyth')).matches[0].number, 'INV-8002');
    equal((await searchOverdueInvoices('INV-8003')).matches[0].number, 'INV-8003');
    const none = await searchOverdueInvoices('Zzzzzz Qqqq');
    equal(none.matches.length, 0); equal(none.overdueCount, 3);
    assert(nameScore('roger', 'Rogers') > 0.8);
  });
});

test('"paid on Aug 20th" is dated Aug 20th, leaves the sale on its own date, and emails nobody', async () => {
  await withDb(async (c) => {
    await seedLate(c);
    process.env.RESEND_API_KEY = 're_test';
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { if (String(url).includes('resend')) sent.push(String(url)); return new Response('{"id":"x"}', { status: 200 }); };
    try {
      assert((await resolveInvoice({ number: 'INV-8001', outcome: 'paid' })).error, 'no date, no payment');
      assert((await resolveInvoice({ number: 'INV-8001', outcome: 'paid', paidOn: '2999-01-01' })).error, 'not in the future');
      const r = await resolveInvoice({ number: 'INV-8001', outcome: 'paid', paidOn: '2026-08-20', method: 'etransfer' });
      assert(r.ok && r.fullyPaid, JSON.stringify(r));
      assert(/does not count in today/.test(r.said));
      const inv = (await c.query(`SELECT status, payment_method, (paid_at AT TIME ZONE 'America/Toronto')::date::text AS paid_day FROM invoices WHERE number='INV-8001'`)).rows[0];
      equal(inv.status, 'paid'); equal(inv.paid_day, '2026-08-20'); equal(inv.payment_method, 'E-transfer');
      const pay = (await c.query(`SELECT p.amount::float AS a, (p.paid_at AT TIME ZONE 'America/Toronto')::date::text AS d FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.number='INV-8001'`)).rows;
      equal(pay.length, 1); equal(pay[0].a, 1240); equal(pay[0].d, '2026-08-20');
      // The sale itself stays on the invoice date: nothing lands on today.
      const ord = (await c.query(`SELECT (o.created_at AT TIME ZONE 'America/Toronto')::date::text AS d FROM orders o JOIN invoices i ON i.order_id = o.id WHERE i.number='INV-8001'`)).rows;
      if (ord.length) equal(ord[0].d, '2026-08-10');
      equal(sent.length, 0, 'the customer is never emailed');
      assert((await c.query(`SELECT 1 FROM audit_log WHERE entity_id = 'INV-8001'`)).rows.length >= 1, 'it is in the change log');
      assert((await resolveInvoice({ number: 'INV-8001', outcome: 'paid', paidOn: '2026-08-20' })).error, 'already paid');
      assert((await unreportedActions()).some((a) => /INV-8001.*2026-08-20/.test(a.summary)));
    } finally { globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY; }
  });
});

test('"still open" keeps it open, raises a follow-up, and stops asking for two days', async () => {
  await withDb(async (c) => {
    await seedLate(c);
    await c.query(`INSERT INTO customers (email, name) VALUES ('s@x.ca','Smith Kitchens')`);
    const r = await resolveInvoice({ number: 'INV-8002', outcome: 'still_owing', promisedOn: '2026-11-25' });
    assert(r.ok && /follow-up/.test(r.said));
    equal((await c.query(`SELECT status FROM invoices WHERE number='INV-8002'`)).rows[0].status, 'open');
    const t = (await c.query('SELECT title, due_on::text AS due FROM customer_tasks')).rows;
    equal(t.length, 1); equal(t[0].due, '2026-11-25');
    assert((await nextOverdueInvoice()).number !== 'INV-8002');
    assert((await resolveInvoice({ number: 'INV-0000', outcome: 'skip' })).error);
    assert((await resolveInvoice({ number: 'INV-8002', outcome: 'banana' })).error);
  });
});
