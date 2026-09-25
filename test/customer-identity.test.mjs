// lib/customers.js — who counts as a customer.
//
// `customers.email` was `text UNIQUE NOT NULL`, so upsertCustomer returned null
// and did nothing for anybody without one. That excluded walk-ins and phone
// orders — the two lead sources the business most wants to measure — from the
// very table the lead-source report was built to explain. Sarah's checkout has
// been passing `email: email || null` and silently creating no customer at all.
//
// These run the REAL module against a real Postgres (PGlite), because the
// interesting behaviour is the SQL: which row a sighting matches, and when it
// creates a second one.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { upsertCustomer, getCustomerProfile, listCustomers } from '../lib/customers.js';
import { phoneKey } from '../lib/constants.js';

async function fresh() { return withTestDb(); }
const row = async (client, id) =>
  (await client.query('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
const count = async (client) =>
  (await client.query('SELECT count(*)::int AS n FROM customers', [])).rows[0].n;

suite('customer identity — a walk-in is a customer');

test('somebody with a phone and NO email is recorded', async () => {
  const { client, done } = await fresh();
  try {
    const id = await upsertCustomer({ name: 'Walk In', phone: '(437) 488-8549' });
    assert(id, 'a phone-only customer must get a record — this returned null before');
    const c = await row(client, id);
    equal(c.email, null, 'no email, and that is allowed now');
    equal(c.name, 'Walk In');
    equal(c.phone, '(437) 488-8549', 'the number is kept as they gave it');
    equal(c.phone_key, '+14374888549', 'and normalised for matching');
  } finally { done(); }
});

test('the same number twice is the same customer, however it was typed', async () => {
  const { client, done } = await fresh();
  try {
    const a = await upsertCustomer({ name: 'Walk In', phone: '4374888549' });
    const b = await upsertCustomer({ phone: '+1 (437) 488-8549', city: 'Pickering' });
    equal(a, b, 'same person');
    equal(await count(client), 1);
    equal((await row(client, a)).city, 'Pickering', 'the later sighting merged in');
  } finally { done(); }
});

test('somebody with neither an email nor a phone is not a customer', async () => {
  // A name on its own is not a record anybody could ever find again.
  const { client, done } = await fresh();
  try {
    equal(await upsertCustomer({ name: 'Just A Name' }), null);
    equal(await upsertCustomer({}), null);
    equal(await upsertCustomer({ email: 'not-an-email' }), null, 'nor is a malformed address');
    equal(await count(client), 0);
  } finally { done(); }
});

suite('customer identity — email still leads');

test('email matches an existing record, as it always did', async () => {
  const { client, done } = await fresh();
  try {
    const a = await upsertCustomer({ email: 'Buyer@Example.CA', name: 'A Buyer' });
    const b = await upsertCustomer({ email: 'buyer@example.ca', phone: '4160000000' });
    equal(a, b, 'case and spacing do not make a second customer');
    equal(await count(client), 1);
    equal((await row(client, a)).phone, '4160000000', 'merged non-empty wins');
  } finally { done(); }
});

test('a fresh value never blanks one we already have', async () => {
  const { client, done } = await fresh();
  try {
    const id = await upsertCustomer({ email: 'a@b.ca', name: 'A', phone: '4160000000', city: 'Ajax' });
    await upsertCustomer({ email: 'a@b.ca', address: '1 Main St' });
    const c = await row(client, id);
    equal(c.phone, '4160000000', 'a checkout with no phone must not erase the phone');
    equal(c.city, 'Ajax');
    equal(c.address, '1 Main St', 'and the new value did land');
  } finally { done(); }
});

suite('customer identity — the upgrade');

test('A WALK-IN WHO LATER GIVES AN EMAIL IS THE SAME PERSON', async () => {
  // The case the whole design turns on. Booked in at the counter with a phone
  // number; buys online a month later and gives an email. One customer, not two.
  const { client, done } = await fresh();
  try {
    const walkIn = await upsertCustomer({ name: 'Sam', phone: '4374888549' });
    const online = await upsertCustomer({ email: 'sam@example.ca', name: 'Sam', phone: '437-488-8549', address: '2 Elm' });
    equal(online, walkIn, 'the phone-only record was upgraded, not duplicated');
    equal(await count(client), 1);

    const c = await row(client, walkIn);
    equal(c.email, 'sam@example.ca', 'their email is filled in');
    equal(c.address, '2 Elm');
    equal(c.phone_key, phoneKey('4374888549'), 'still keyed on the same number');
  } finally { done(); }
});

test('the phone does NOT merge two people who both have emails', async () => {
  // Two family members sharing a landline are two customers. Treating the phone
  // as an identity for records that already have an email would merge them, and
  // losing a real customer is worse than holding a duplicate.
  const { client, done } = await fresh();
  try {
    const a = await upsertCustomer({ email: 'mum@example.ca', name: 'Mum', phone: '9055551234' });
    const b = await upsertCustomer({ email: 'dad@example.ca', name: 'Dad', phone: '9055551234' });
    assert(a !== b, 'these must stay two customers');
    equal(await count(client), 2);
  } finally { done(); }
});

test('an upgrade takes the most recent phone-only record, not a random one', async () => {
  const { client, done } = await fresh();
  try {
    const older = await upsertCustomer({ name: 'Older', phone: '4161111111' });
    // A second phone-only record on a DIFFERENT number, to prove the match is
    // on the number and not merely "the newest row".
    await upsertCustomer({ name: 'Someone Else', phone: '4162222222' });
    const up = await upsertCustomer({ email: 'older@example.ca', phone: '4161111111' });
    equal(up, older, 'matched on the number');
    equal(await count(client), 2);
  } finally { done(); }
});

suite('customer identity — the database enforces it too');

test('two phone-only records cannot hold the same number', async () => {
  const { client, done } = await fresh();
  try {
    await client.query(
      `INSERT INTO customers (name, phone_key) VALUES ('One', '+14374888549')`, []
    );
    let err = null;
    try {
      await client.query(`INSERT INTO customers (name, phone_key) VALUES ('Two', '+14374888549')`, []);
    } catch (e) { err = e; }
    assert(err, 'the partial unique index must refuse a second phone-only row');
  } finally { done(); }
});

test('but two records WITH emails may share a number', async () => {
  const { client, done } = await fresh();
  try {
    await client.query(`INSERT INTO customers (email, phone_key) VALUES ('a@b.ca','+14374888549')`, []);
    await client.query(`INSERT INTO customers (email, phone_key) VALUES ('c@d.ca','+14374888549')`, []);
    equal(await count(client), 2, 'a shared landline is allowed');
  } finally { done(); }
});

test('a row identified by nothing is refused', async () => {
  const { client, done } = await fresh();
  try {
    let err = null;
    try { await client.query(`INSERT INTO customers (name) VALUES ('Nobody')`, []); }
    catch (e) { err = e; }
    assert(err, 'the CHECK must refuse a customer with neither an email nor a number');
  } finally { done(); }
});

suite('customer identity — a phone-only customer can see their own history');

// The point of the read changes. A walk-in who exists but shows no orders is
// worse than not having the record: somebody looks them up, sees nothing, and
// concludes the CRM is broken.
//
// NOTE that `orders.email` is still NOT NULL — this change made CUSTOMERS
// email-optional, not orders. So an order for a walk-in carries whatever
// address the counter took, and the customer is matched to it on the PHONE
// because they have no email of their own to match on. Making orders
// email-optional too is a separate change with a much larger blast radius
// (checkout, invoices, order emails, analytics, the fraud checks).
async function withOrder(client, { email, phone, number, total }) {
  await client.query(
    `INSERT INTO orders (order_number, email, name, phone, status, subtotal, hst, total, delivery_method)
     VALUES ($1,$2,'A Buyer',$3,'delivered',$4,0,$4,'pickup')`,
    [number, email, phone, total]
  );
}

test('their orders are found by PHONE, whatever address is on the order', async () => {
  const { client, done } = await fresh();
  try {
    const id = await upsertCustomer({ name: 'Walk In', phone: '(437) 488-8549' });
    await withOrder(client, { email: 'counter@bargainbay.ca', phone: '4374888549', number: 'BB-2001', total: 500 });

    const profile = await getCustomerProfile(id);
    equal(profile.history.orders.length, 1, 'the order is on their profile');
    equal(profile.history.orders[0].number, 'BB-2001');
    equal(profile.orders, 1, 'and counted in the rollup');
    equal(profile.spent, 500);
  } finally { done(); }
});

test('the list credits a phone-only customer with their spend', async () => {
  const { client, done } = await fresh();
  try {
    await upsertCustomer({ name: 'Walk In', phone: '4374888549' });
    await withOrder(client, { email: 'counter@bargainbay.ca', phone: '(437) 488-8549', number: 'BB-2002', total: 250 });
    const [c] = await listCustomers({});
    equal(c.orders, 1);
    equal(c.spent, 250, 'however the number was typed on the order');
  } finally { done(); }
});

test('a shared landline does NOT show one person the other\'s orders', async () => {
  // Both have emails, so the phone arm must not apply to either.
  const { client, done } = await fresh();
  try {
    const mum = await upsertCustomer({ email: 'mum@example.ca', name: 'Mum', phone: '9055551234' });
    await upsertCustomer({ email: 'dad@example.ca', name: 'Dad', phone: '9055551234' });
    await withOrder(client, { email: 'dad@example.ca', phone: '9055551234', number: 'BB-2003', total: 900 });

    const profile = await getCustomerProfile(mum);
    equal(profile.history.orders.length, 0, "Dad's order must not appear on Mum's profile");
    equal(profile.spent, 0);
  } finally { done(); }
});

test('a phone-only customer is findable by number in the list search', async () => {
  const { done } = await fresh();
  try {
    await upsertCustomer({ name: 'Walk In', phone: '(437) 488-8549' });
    equal((await listCustomers({ q: '488-8549' })).length, 1, 'as they typed it');
    equal((await listCustomers({ q: 'walk in' })).length, 1, 'or by name');
  } finally { done(); }
});
