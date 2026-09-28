// Who marketing can reach, and getting past the first page of customers.
//
// audience() used to read `users`, so it could only reach people who had
// created an ACCOUNT. Every guest checkout, invoiced client, phone lead and
// walk-in was invisible to marketing — while backfillCustomers was busy
// assembling exactly those people into a table nothing marketed to. The CRM and
// the mailing list were two different databases that did not speak.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  upsertCustomer, marketingAudience, listCustomers, countCustomers, backfillCustomers
} from '../lib/customers.js';

const fresh = () => withTestDb();
const emails = (list) => list.map((r) => r.email).filter(Boolean).sort();

async function order(c, { email, phone = null, number, status = 'delivered' }) {
  await c.query(
    `INSERT INTO orders (order_number, email, name, phone, status, total, delivery_method)
     VALUES ($1,$2,'X',$3,$4,100,'pickup')`, [number, email, phone, status]
  );
}

suite('marketing audience — the guest buyer is no longer invisible');

test('A GUEST WHO NEVER MADE AN ACCOUNT IS REACHABLE', async () => {
  // The whole point. This person bought something and could not be marketed to.
  const { client, done } = await fresh();
  try {
    await upsertCustomer({ email: 'guest@example.ca', name: 'Guest' });
    await order(client, { email: 'guest@example.ca', number: 'BB-1' });
    equal(emails(await marketingAudience('buyers')), ['guest@example.ca']);
  } finally { done(); }
});

test('somebody who has never bought is not in "buyers"', async () => {
  const { done } = await fresh();
  try {
    await upsertCustomer({ email: 'browser@example.ca', name: 'Just Looking' });
    equal(await marketingAudience('buyers'), []);
    equal(emails(await marketingAudience('all')), ['browser@example.ca'], 'but is in "all"');
  } finally { done(); }
});

test('a cancelled order is not a purchase', async () => {
  const { client, done } = await fresh();
  try {
    await upsertCustomer({ email: 'a@b.ca' });
    await order(client, { email: 'a@b.ca', number: 'BB-2', status: 'cancelled' });
    equal(await marketingAudience('buyers'), []);
  } finally { done(); }
});

test('a PHONE-ONLY customer is reachable by text', async () => {
  // 2.1 made them recordable; this makes them reachable. Their order is matched
  // on the phone, exactly as the customer list matches it.
  const { client, done } = await fresh();
  try {
    await upsertCustomer({ name: 'Walk In', phone: '4374888549' });
    await order(client, { email: 'counter@bargainbay.ca', phone: '(437) 488-8549', number: 'BB-3' });
    const list = await marketingAudience('buyers');
    equal(list.length, 1);
    equal(list[0].phone, '4374888549');
    equal(list[0].email, null, 'no email, and that is fine for SMS');
  } finally { done(); }
});

suite('marketing audience — drivers are not customers');

test('DRIVER ACCOUNTS ARE EXCLUDED FROM EVERY SEGMENT', async () => {
  // backfillCustomers sweeps all of `users`, so the synthetic
  // driver-<digits>@drivers.bargainbay.ca accounts are in the customer table.
  // The consent gate already stops them being texted, but they would inflate
  // every audience count — and a count somebody trusts is worse than one they
  // cannot get.
  const { client, done } = await fresh();
  try {
    await client.query(
      `INSERT INTO users (email, name, phone, password_hash, is_driver)
       VALUES ('driver-4374888549@drivers.bargainbay.ca','Ruban','4374888549','x',true)`, []
    );
    await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ('real@example.ca','A Customer','x')`, []
    );
    await backfillCustomers();

    const { rows } = await client.query('SELECT count(*)::int AS n FROM customers', []);
    equal(rows[0].n, 2, 'both are in the customer table — that is the problem');

    equal(emails(await marketingAudience('all')), ['real@example.ca'],
      'but only one of them is marketing');
  } finally { done(); }
});

suite('marketing audience — members');

test('only an APPROVED member counts', async () => {
  const { client, done } = await fresh();
  try {
    for (const [email, status] of [['yes@x.ca', 'approved'], ['pending@x.ca', 'pending']]) {
      const { rows } = await client.query(
        `INSERT INTO users (email, name, password_hash, role, member_status)
         VALUES ($1,'M','x','member',$2) RETURNING id`, [email, status]
      );
      await client.query(
        `INSERT INTO customers (email, name, user_id) VALUES ($1,'M',$2)`, [email, rows[0].id]
      );
    }
    equal(emails(await marketingAudience('members')), ['yes@x.ca']);
  } finally { done(); }
});

suite('the nightly backfill actually runs');

test('REGRESSION: ON CONFLICT must match the PARTIAL unique index', async () => {
  // 2.1 made email nullable and replaced the column's UNIQUE constraint with a
  // partial unique index. A conflict target has to match that index's own
  // predicate, so a bare `ON CONFLICT (email)` stopped resolving — and
  // backfillCustomers catches and logs, so it failed SILENTLY on every nightly
  // run until this test was written.
  const { client, done } = await fresh();
  try {
    await client.query(
      `INSERT INTO users (email, name, phone, password_hash) VALUES ('acct@x.ca','Acct','4160000000','x')`, []
    );
    await order(client, { email: 'guest@x.ca', number: 'BB-9' });

    const res = await backfillCustomers();
    equal(res.ok, true, 'the sweep must not fail');
    equal(res.customers, 2, 'the account AND the guest');
    equal(emails(await listCustomers({})), ['acct@x.ca', 'guest@x.ca']);
  } finally { done(); }
});

test('running the backfill twice changes nothing', async () => {
  const { client, done } = await fresh();
  try {
    await order(client, { email: 'guest@x.ca', number: 'BB-10' });
    await backfillCustomers();
    const second = await backfillCustomers();
    equal(second.customers, 1, 'idempotent');
  } finally { done(); }
});

suite('customer list — getting past the first page');

test('the list is paged, and says what it is a page OF', async () => {
  // Customer 501 used to be simply unreachable, which on a growing list is the
  // same as not having them.
  const { client, done } = await fresh();
  try {
    for (let i = 0; i < 12; i++) {
      await client.query(`INSERT INTO customers (email, name) VALUES ($1,$2)`, [`c${i}@x.ca`, `C${i}`]);
    }
    equal(await countCustomers({}), 12);
    equal((await listCustomers({ limit: 5, offset: 0 })).length, 5);
    equal((await listCustomers({ limit: 5, offset: 10 })).length, 2, 'the last partial page');

    const first = await listCustomers({ limit: 5, offset: 0 });
    const second = await listCustomers({ limit: 5, offset: 5 });
    const overlap = first.filter((a) => second.some((b) => b.id === a.id));
    equal(overlap, [], 'pages must not repeat a customer');
  } finally { done(); }
});

test('the count respects the search', async () => {
  const { client, done } = await fresh();
  try {
    for (const [e, n] of [['a@x.ca', 'Alice Smith'], ['b@x.ca', 'Bob Smith'], ['c@x.ca', 'Carol Jones']]) {
      await client.query(`INSERT INTO customers (email, name) VALUES ($1,$2)`, [e, n]);
    }
    equal(await countCustomers({ q: 'smith' }), 2);
    equal(await countCustomers({ q: 'nobody' }), 0);
    equal(await countCustomers({}), 3);
  } finally { done(); }
});

test('a phone number is findable however either side spelled it', async () => {
  // A number has as many spellings as people who type it. A search that only
  // works when the needle matches the stored form is a search reps stop using.
  const { done } = await fresh();
  try {
    await upsertCustomer({ name: 'Walk In', phone: '4374888549' });          // stored bare
    await upsertCustomer({ email: 'b@x.ca', name: 'Other', phone: '(416) 555-1212' }); // stored formatted

    for (const q of ['4374888549', '488-8549', '(437) 488-8549', '437 488 8549']) {
      equal((await listCustomers({ q })).length, 1, `searching "${q}" should find the bare one`);
      equal(await countCustomers({ q }), 1, `and the count must agree for "${q}"`);
    }
    for (const q of ['4165551212', '555-1212']) {
      equal((await listCustomers({ q })).length, 1, `searching "${q}" should find the formatted one`);
    }
    // The digit-stripping arm is OFF below four digits, or a needle of "1"
    // would match every number containing a 1 once punctuation is removed.
    // Isolated with a needle that can ONLY match via stripping: "748" appears
    // in 4374888549 but not in the stored "437.488.8549".
    await upsertCustomer({ email: 'c@x.ca', name: 'Dotted', phone: '437.488.8549' });
    equal(await countCustomers({ q: '748' }), 0, 'three digits does not trigger a normalised match');
    equal(await countCustomers({ q: '7488' }), 1, 'four does');
  } finally { done(); }
});
