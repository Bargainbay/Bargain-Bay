// lib/customers.js — merging two records that are one person.
//
// 2.1 made duplicates possible deliberately: the phone is an identity only for
// a record with no email, so two family members sharing a landline stay two
// customers. This is the other half of that decision.
//
// Merging customers is NOT like merging drivers. A driver's work is linked by a
// real foreign key; NOTHING carries a customer_id — orders, invoices and quotes
// are matched by email address. So a merge cannot move rows: the survivor
// absorbs the other record's identities and every lookup sees through them.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import {
  upsertCustomer, mergeCustomers, getCustomerProfile, customerAliases, duplicateCandidates
} from '../lib/customers.js';

const fresh = () => withTestDb();
const row = async (c, id) => (await c.query('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
const count = async (c) => (await c.query('SELECT count(*)::int AS n FROM customers', [])).rows[0].n;

async function order(c, { email, phone = null, number, total }) {
  await c.query(
    `INSERT INTO orders (order_number, email, name, phone, status, subtotal, hst, total, delivery_method)
     VALUES ($1,$2,'X',$3,'delivered',$4,0,$4,'pickup')`,
    [number, email, phone, total]
  );
}

suite('merging customers — the history comes with them');

test('BOTH RECORDS’ ORDERS END UP ON THE SURVIVOR', async () => {
  // The one outcome a merge must never have is losing somebody's history.
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'sam@work.ca', name: 'Sam' });
    const drop = await upsertCustomer({ email: 'sam@home.ca', name: 'Sam' });
    await order(client, { email: 'sam@work.ca', number: 'BB-3001', total: 100 });
    await order(client, { email: 'sam@home.ca', number: 'BB-3002', total: 250 });

    await mergeCustomers(keep, drop, { by: 'owner@rssolutions.ca' });

    const p = await getCustomerProfile(keep);
    equal(p.history.orders.map((o) => o.number).sort(), ['BB-3001', 'BB-3002'],
      'both orders are on the surviving record');
    equal(p.spent, 350, 'and the rollup counts both');
    equal(await count(client), 1, 'one customer left');
  } finally { done(); }
});

test('THE MERGE SURVIVES THE CUSTOMER’S NEXT ORDER', async () => {
  // Without an alias lookup in upsertCustomer, the next order from the absorbed
  // address simply recreates the duplicate — the merge would last exactly until
  // the customer next bought something.
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'sam@work.ca', name: 'Sam' });
    const drop = await upsertCustomer({ email: 'sam@home.ca', name: 'Sam' });
    await mergeCustomers(keep, drop);

    const again = await upsertCustomer({ email: 'sam@home.ca', name: 'Sam', city: 'Ajax' });
    equal(again, keep, 'the absorbed address resolves to the survivor');
    equal(await count(client), 1, 'no duplicate was recreated');
    equal((await row(client, keep)).city, 'Ajax', 'and the sighting still merged in');
  } finally { done(); }
});

test('an absorbed PHONE resolves to the survivor too', async () => {
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'sam@work.ca', name: 'Sam' });
    const drop = await upsertCustomer({ name: 'Sam', phone: '4374888549' });
    await mergeCustomers(keep, drop);

    const again = await upsertCustomer({ phone: '(437) 488-8549' });
    equal(again, keep);
    equal(await count(client), 1);
  } finally { done(); }
});

suite('merging customers — what wins');

test('the survivor’s own values are never overwritten', async () => {
  // A merge must not replace something somebody typed with something older.
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'a@b.ca', name: 'Correct Name', city: 'Pickering' });
    const drop = await upsertCustomer({ email: 'c@d.ca', name: 'Old Name', city: 'Oshawa', address: '9 Elm' });
    await mergeCustomers(keep, drop);

    const c = await row(client, keep);
    equal(c.name, 'Correct Name', 'kept');
    equal(c.city, 'Pickering', 'kept');
    equal(c.address, '9 Elm', 'but a BLANK was filled from the other record');
  } finally { done(); }
});

test('a phone-only survivor gains the other record’s email as its own', async () => {
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ name: 'Sam', phone: '4374888549' });
    const drop = await upsertCustomer({ email: 'sam@example.ca', name: 'Sam' });
    await mergeCustomers(keep, drop);

    const c = await row(client, keep);
    equal(c.email, 'sam@example.ca', 'filled a blank, so it is theirs now');
    // ...and therefore must NOT also be recorded as an alias of themselves.
    const aliases = await customerAliases(keep);
    assert(!aliases.some((a) => a.value === 'sam@example.ca'),
      'an identity the survivor now owns is not also an alias of itself');
  } finally { done(); }
});

test('notes are joined, not lost', async () => {
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    const drop = await upsertCustomer({ email: 'c@d.ca', name: 'Sam' });
    await client.query(`UPDATE customers SET notes = 'prefers mornings' WHERE id = $1`, [keep]);
    await client.query(`UPDATE customers SET notes = 'has a narrow staircase' WHERE id = $1`, [drop]);
    await mergeCustomers(keep, drop);

    const notes = (await row(client, keep)).notes;
    assert(/prefers mornings/.test(notes), 'the survivor’s note is kept');
    assert(/narrow staircase/.test(notes), 'and the other one is not thrown away');
  } finally { done(); }
});

test('the survivor keeps the EARLIER first-sighting', async () => {
  // Merging must not make a long-standing customer look new.
  const { client, done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'a@b.ca', name: 'Sam' });
    const drop = await upsertCustomer({ email: 'c@d.ca', name: 'Sam' });
    await client.query(`UPDATE customers SET created_at = now() - interval '2 years' WHERE id = $1`, [drop]);
    await mergeCustomers(keep, drop);

    const { rows } = await client.query(
      `SELECT created_at < now() - interval '1 year' AS old FROM customers WHERE id = $1`, [keep]
    );
    assert(rows[0].old, 'the older of the two first-sightings wins');
  } finally { done(); }
});

suite('merging customers — refusals and repeat merges');

test('a customer cannot be merged into itself, or into a ghost', async () => {
  const { done } = await fresh();
  try {
    const a = await upsertCustomer({ email: 'a@b.ca', name: 'A' });
    for (const [x, y, why] of [[a, a, 'itself'], [a, 99999, 'a ghost'], [99999, a, 'from a ghost'], [0, a, 'nothing']]) {
      let err = null;
      try { await mergeCustomers(x, y); } catch (e) { err = e; }
      assert(err, `merging ${why} should be refused`);
    }
  } finally { done(); }
});

test('a second merge carries the first one’s aliases across', async () => {
  // Otherwise merging A<-B and then A<-C is fine, but merging A<-B then C<-A
  // orphans B's history.
  const { client, done } = await fresh();
  try {
    const a = await upsertCustomer({ email: 'a@x.ca', name: 'Sam' });
    const b = await upsertCustomer({ email: 'b@x.ca', name: 'Sam' });
    const c = await upsertCustomer({ email: 'c@x.ca', name: 'Sam' });
    await order(client, { email: 'b@x.ca', number: 'BB-3010', total: 75 });

    await mergeCustomers(a, b);   // a absorbs b
    await mergeCustomers(c, a);   // c absorbs a, which already held b

    const p = await getCustomerProfile(c);
    equal(p.history.orders.map((o) => o.number), ['BB-3010'],
      'the twice-removed record’s order is still found');
    const values = (await customerAliases(c)).map((x) => x.value).sort();
    equal(values, ['a@x.ca', 'b@x.ca'], 'both absorbed addresses point at the survivor');
    equal(await count(client), 1);
  } finally { done(); }
});

test('the trail records where an identity came from', async () => {
  const { done } = await fresh();
  try {
    const keep = await upsertCustomer({ email: 'a@b.ca', name: 'Keep' });
    const drop = await upsertCustomer({ email: 'c@d.ca', name: 'Drop Me' });
    await mergeCustomers(keep, drop, { by: 'owner@rssolutions.ca' });

    const [alias] = await customerAliases(keep);
    equal(alias.value, 'c@d.ca');
    equal(alias.merged_by, 'owner@rssolutions.ca', 'who did it');
    assert(/Drop Me/.test(alias.note), 'and which record it came from');
  } finally { done(); }
});

suite('merging customers — finding the duplicates');

test('records sharing a phone or a name are proposed, never merged', async () => {
  const { done } = await fresh();
  try {
    await upsertCustomer({ email: 'mum@x.ca', name: 'Pat Taylor', phone: '9055551234' });
    await upsertCustomer({ email: 'dad@x.ca', name: 'Chris Taylor', phone: '9055551234' });
    await upsertCustomer({ email: 'one@x.ca', name: 'Jamie Brown' });
    await upsertCustomer({ email: 'two@x.ca', name: 'jamie brown ' });

    const found = await duplicateCandidates({});
    const reasons = found.map((f) => f.why).sort();
    equal(reasons, ['same name', 'same phone'], 'both kinds are proposed');
    // And nothing was actually merged — a household sharing a phone is two
    // people, and an automatic merge is unpickable.
    assert(found.length === 2);
  } finally { done(); }
});

test('a short or missing name is not treated as a match', async () => {
  const { done } = await fresh();
  try {
    await upsertCustomer({ email: 'a@x.ca', name: 'Jo' });
    await upsertCustomer({ email: 'b@x.ca', name: 'Jo' });
    await upsertCustomer({ email: 'c@x.ca' });
    await upsertCustomer({ email: 'd@x.ca' });
    equal(await duplicateCandidates({}), [], 'two-letter names and blanks are not evidence');
  } finally { done(); }
});
