// Seller <-> staff messaging against a real database: tenant isolation, internal notes never reaching a seller,
// the author coming from the session, read state, the email throttle, the rate limit, tie-ins belonging to the
// same seller, the customer-contact guard, and the route shapes.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { createApplication, decideApplication, grantVendorUser } from '../lib/vendors.js';
import {
  startVendorThread, replyVendor, listVendorThreads, getVendorThread, vendorUnreadCount, startStaffThread, replyStaff, listStaffThreads,
  getStaffThread, assignThread, closeThread, reopenThread, staffUnreadCount, ContactDetailsError, MAX_BODY, VENDOR_MESSAGES_PER_HOUR, VENDOR_THREADS_PER_DAY
} from '../lib/vendor-messages.js';
import { contactDetailsIn } from '../lib/contact-guard.js';

async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw'); if (re) assert(re.test(err.message), `message was: ${err.message}`);
  return err;
}
const T0 = new Date('2026-10-20T14:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000);

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase()}@example.com` });
  await decideApplication(v.id, { approve: true, by: 's', hstStatus: 'registered' });
  await grantVendorUser(v.id, { email: `${name.toLowerCase()}-user@example.com`, role: 'owner', by: 's' });
  return v;
}
let n = 0;
async function listing(v) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO marketplace_listings (sku, vendor_id, lane, status, category, make, model, serial_private, condition, title, price, warranty_months, weight_lb, width_in, depth_in, height_in, tested_working)
     VALUES ($1,$2,'A','live','Refrigerator','Whirlpool','WRF535',$3,'Refurbished','A fridge',1000,12,60,24,24,34,true) RETURNING id`, [`MP-${v.id}-M${n}`, v.id, `SN-M${n}`]);
  return rows[0].id;
}
async function vendorOrder(v) {
  const { rows: o } = await query(`INSERT INTO orders (email, name, phone, delivery_method, status, subtotal, hst, total) VALUES ('cust-private@example.com','Cust Private','416-555-0199','delivery','confirmed',0,0,0) RETURNING id`);
  const { rows } = await query(
    `INSERT INTO vendor_orders (order_id, order_number, vendor_id, lane, status, item_cents) VALUES ($1,$2,$3,'A','accepted',100000) RETURNING id`, [o[0].id, `BB-${5000 + o[0].id}`, v.id]);
  return rows[0].id;
}

// Capture outbound mail without sending: staging redirect + a stubbed fetch.
async function withMail(fn) {
  const keys = ['VERCEL_ENV', 'STAGING_EMAIL_TO', 'RESEND_API_KEY', 'ALLOW_REAL_OUTBOUND'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.VERCEL_ENV; delete process.env.ALLOW_REAL_OUTBOUND;
  process.env.RESEND_API_KEY = 're_test'; process.env.STAGING_EMAIL_TO = 'catch@example.com';
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{"id":"x"}' }; };
  try { return await fn(sent); } finally {
    globalThis.fetch = realFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

suite('vendor messages — isolation, internal notes, authors');

test('a seller sees only their own threads; another seller\'s id is simply not there', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const ta = await startVendorThread(a.id, { subject: 'Pickup', body: 'When can you collect?', by: 'alpha-user@example.com', byName: 'Alpha Owner', now: at(0) });
    equal((await listVendorThreads(a.id)).length, 1);
    equal((await listVendorThreads(b.id)).length, 0);
    equal(await getVendorThread(b.id, ta.id), null);
    await rejects(() => replyVendor(b.id, ta.id, { body: 'hello', by: 'beta-user@example.com' }), /not found/);
    equal((await getStaffThread(ta.id)).messages.length, 1);   // and Beta's attempt wrote nothing
  } finally { done(); }
});

test('internal notes are stored but NEVER in any seller payload', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'Price', body: 'Can I lower it?', by: 'alpha-user@example.com', now: at(0) });
    await replyStaff(t.id, { body: 'SECRET-INTERNAL: seller has been late twice', internal: true, by: 'rep@bargainbay.ca', byName: 'Rep', now: at(1) });
    await replyStaff(t.id, { body: 'Yes, go ahead.', by: 'rep@bargainbay.ca', byName: 'Rep', now: at(2) });
    const staff = await getStaffThread(t.id);
    equal(staff.messages.length, 3);
    assert(staff.messages.some((m) => m.internal && /SECRET-INTERNAL/.test(m.body)), 'staff see the note');
    const vend = await getVendorThread(a.id, t.id, { now: at(3) });
    equal(vend.messages.length, 2);
    assert(!/SECRET-INTERNAL/.test(JSON.stringify(vend)), 'not in the thread');
    assert(!/SECRET-INTERNAL/.test(JSON.stringify(await listVendorThreads(a.id))), 'not in the list preview either');
    assert(!/rep@bargainbay/.test(JSON.stringify(vend)), 'a staff member\'s email address is not shown to the seller');
    // an internal note alone never makes a thread unread for the seller or moves who is waiting
    await replyStaff(t.id, { body: 'SECRET-INTERNAL again', internal: true, by: 'rep@bargainbay.ca', now: at(4) });
    equal(await vendorUnreadCount(a.id), 0);
    equal((await getStaffThread(t.id)).lastPublicSide, 'staff');
  } finally { done(); }
});

test('the database refuses to edit or delete a message, and an internal message must be staff\'s', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'first', by: 'alpha-user@example.com' });
    await rejects(() => query(`UPDATE vendor_messages SET body = 'changed' WHERE thread_id = $1`, [t.id]), /append-only/);
    await rejects(() => query(`DELETE FROM vendor_messages WHERE thread_id = $1`, [t.id]), /append-only/);
    await rejects(() => query(`INSERT INTO vendor_messages (thread_id, side, internal, author_email, body) VALUES ($1,'vendor',true,'a@b.c','sneaky')`, [t.id]));
  } finally { done(); }
});

test('the author is stamped from the caller and snapshotted, and the body cannot choose it', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'hi', by: 'Alpha-User@Example.com', byName: 'Alpha Owner', now: at(0), author: 'forged@x.com', side: 'staff' });
    const m = (await getStaffThread(t.id)).messages[0];
    equal(m.email, 'alpha-user@example.com'); equal(m.from, 'Alpha Owner'); equal(m.side, 'vendor');
    await rejects(() => startVendorThread(a.id, { subject: 'x', body: 'hi' }), /Who is sending/);
    // the routes take the author from the session and never read one from the body
    const { readFileSync } = await import('node:fs');
    const vr = readFileSync(new URL('../app/api/vendor/messages/route.js', import.meta.url), 'utf8');
    const sr = readFileSync(new URL('../app/api/admin/marketplace/messages/route.js', import.meta.url), 'utf8');
    assert(/requireVendor/.test(vr) && /const by = ctx\.session\.email/.test(vr) && !/b\.(by|author|vendorId|side)/.test(vr), 'vendor route: session only');
    assert(/!isStaff\(s\)\) return denied/.test(sr) && /const by = s\.email/.test(sr) && !/isAdmin/.test(sr) && !/b\.(by|author)/.test(sr), 'staff route: staff-level, session author');
  } finally { done(); }
});

suite('vendor messages — read state, limits, ties, contact guard');

test('unread counts are per side and clear on reading; replying counts as having read', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'hi', by: 'alpha-user@example.com', now: at(0) });
    equal(await vendorUnreadCount(a.id), 0);        // their own message is not unread to them
    equal(await staffUnreadCount(), 1);
    assert((await listStaffThreads({ filter: 'open' }))[0].unread);
    await getStaffThread(t.id, { now: at(1) });
    equal(await staffUnreadCount(), 0);
    await replyStaff(t.id, { body: 'hello', by: 'rep@bargainbay.ca', now: at(2) });
    equal(await vendorUnreadCount(a.id), 1);
    assert((await listVendorThreads(a.id))[0].unread);
    await getVendorThread(a.id, t.id, { now: at(3) });
    equal(await vendorUnreadCount(a.id), 0);
    await replyStaff(t.id, { body: 'again', by: 'rep@bargainbay.ca', now: at(4) });
    equal(await vendorUnreadCount(a.id), 1);
    await replyVendor(a.id, t.id, { body: 'thanks', by: 'alpha-user@example.com', now: at(5) });
    equal(await vendorUnreadCount(a.id), 0);
    equal(await staffUnreadCount(), 1);
  } finally { done(); }
});

test('filters: awaiting us / awaiting seller / closed; closing, reopening and a reply that reopens; events logged', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'hi', by: 'alpha-user@example.com', now: at(0) });
    equal((await listStaffThreads({ filter: 'awaiting_us' })).length, 1);
    equal((await listStaffThreads({ filter: 'awaiting_vendor' })).length, 0);
    await assignThread(t.id, { to: 'Rep@BargainBay.ca', by: 'rep@bargainbay.ca' });
    equal((await getStaffThread(t.id)).assignedTo, 'rep@bargainbay.ca');
    await replyStaff(t.id, { body: 'on it', by: 'rep@bargainbay.ca', now: at(1) });
    equal((await listStaffThreads({ filter: 'awaiting_us' })).length, 0);
    equal((await listStaffThreads({ filter: 'awaiting_vendor' })).length, 1);
    await closeThread(t.id, { by: 'rep@bargainbay.ca', now: at(2) });
    equal((await listStaffThreads({ filter: 'open' })).length, 0);
    equal((await listStaffThreads({ filter: 'closed' })).length, 1);
    await rejects(() => closeThread(t.id, { by: 'rep@bargainbay.ca' }), /not open/);
    await reopenThread(t.id, { by: 'rep@bargainbay.ca' });
    await closeThread(t.id, { by: 'rep@bargainbay.ca' });
    await replyVendor(a.id, t.id, { body: 'one more thing', by: 'alpha-user@example.com', now: at(3) });   // reopens
    equal((await getVendorThread(a.id, t.id)).status, 'open');
    const ev = (await query(`SELECT event FROM vendor_events WHERE vendor_id = $1 ORDER BY id`, [a.id])).rows.map((r) => r.event);
    assert(ev.includes('thread_opened') && ev.filter((e) => e === 'thread_closed').length === 2 && ev.filter((e) => e === 'thread_reopened').length === 2, ev.join());
  } finally { done(); }
});

test('tie-ins must belong to the SAME seller', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const la = await listing(a); const lb = await listing(b); const oa = await vendorOrder(a); const ob = await vendorOrder(b);
    const t = await startVendorThread(a.id, { subject: 'about my order', body: 'hi', vendorOrderId: oa, listingId: la, by: 'alpha-user@example.com', now: at(0) });
    const v = await getVendorThread(a.id, t.id);
    assert(/^BB-/.test(v.tie.orderNumber) && /^MP-/.test(v.tie.listingSku));
    await rejects(() => startVendorThread(a.id, { subject: 's', body: 'b', vendorOrderId: ob, by: 'alpha-user@example.com' }), /not one of this seller/);
    await rejects(() => startVendorThread(a.id, { subject: 's', body: 'b', listingId: lb, by: 'alpha-user@example.com' }), /not one of this seller/);
    await rejects(() => startStaffThread({ vendorId: a.id, subject: 's', body: 'b', vendorOrderId: ob, by: 'rep@bargainbay.ca' }), /not one of this seller/);
    await rejects(() => startVendorThread(a.id, { subject: 's', body: 'b', claimId: 9999, by: 'alpha-user@example.com' }), /not one of this seller/);
    // a tied thread exposes only what vendor-orders already shows a seller: no customer field anywhere
    assert(!/cust-private|Cust Private|416-555/.test(JSON.stringify(v)), 'no customer details');
  } finally { done(); }
});

test('rate limits are counted from rows: messages per hour and new threads per day; length cap; subject required', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Beta');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'm0', by: 'alpha-user@example.com', now: at(0) });
    for (let i = 1; i < VENDOR_MESSAGES_PER_HOUR; i++) await replyVendor(a.id, t.id, { body: `m${i}`, by: 'alpha-user@example.com', now: at(i % 50) });
    await rejects(() => replyVendor(a.id, t.id, { body: 'too many', by: 'alpha-user@example.com', now: at(55) }), /in the last hour/);
    await replyVendor(a.id, t.id, { body: 'an hour later', by: 'alpha-user@example.com', now: at(125) });   // the window has moved on
    await startVendorThread(b.id, { subject: 'b', body: 'hi', by: 'beta-user@example.com', now: at(0) });   // Beta is unaffected
    const c = await vendor('Gamma');
    for (let i = 0; i < VENDOR_THREADS_PER_DAY; i++) await startVendorThread(c.id, { subject: `s${i}`, body: 'hi', by: 'gamma-user@example.com', now: at(i * 7) });
    await rejects(() => startVendorThread(c.id, { subject: 'one more', body: 'hi', by: 'gamma-user@example.com', now: at(200) }), /new conversations a day/);
    await rejects(() => replyVendor(b.id, 1, { body: 'x'.repeat(MAX_BODY + 1), by: 'beta-user@example.com' }), /limited to/);
    await rejects(() => startVendorThread(b.id, { subject: '  ', body: 'hi', by: 'beta-user@example.com' }), /subject/);
    await rejects(() => startVendorThread(b.id, { subject: 's', body: '   ', by: 'beta-user@example.com' }), /Write a message/);
  } finally { done(); }
});

test('the contact guard: a staff message that looks like customer contact needs a confirmation; internal notes and sellers are exempt', async () => {
  assert(contactDetailsIn('call her on (416) 555-0199').includes('phone number'));
  assert(contactDetailsIn('416.555.0199').length === 1 && contactDetailsIn('+1 416 555 0199').length === 1);
  assert(contactDetailsIn('email jo@gmail.com').includes('email address'));
  equal(contactDetailsIn('Order BB-1234 / unit MP-12-0001 is ready').length, 0);
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const t = await startVendorThread(a.id, { subject: 'x', body: 'my number is 416-555-0100', by: 'alpha-user@example.com', now: at(0) });   // a seller may say their own
    const e = await rejects(() => replyStaff(t.id, { body: 'The customer is jo@gmail.com', by: 'rep@bargainbay.ca' }), /customer's contact details/);
    assert(e instanceof ContactDetailsError && e.needsConfirm);
    equal((await getStaffThread(t.id)).messages.length, 1);                       // nothing was written
    await rejects(() => startStaffThread({ vendorId: a.id, subject: 's', body: 'ring 647 555 0123', by: 'rep@bargainbay.ca' }), /contact details/);
    await replyStaff(t.id, { body: 'Customer is jo@gmail.com (internal)', internal: true, by: 'rep@bargainbay.ca' });   // internal: fine
    await replyStaff(t.id, { body: 'Our warehouse is 905 555 0100', confirmContact: true, by: 'rep@bargainbay.ca' });     // confirmed
    equal((await getStaffThread(t.id)).messages.length, 3);
    // the staff API turns it into a 409 the composer can act on
    const { readFileSync } = await import('node:fs');
    assert(/needsConfirm[^\n]*status: 409/.test(readFileSync(new URL('../app/api/admin/marketplace/messages/route.js', import.meta.url), 'utf8')));
  } finally { done(); }
});

suite('vendor messages — notifications');

test('one email per side per thread per 15 minutes; never the message text; a failed send does not eat the slot or block the write', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    await withMail(async (sent) => {
      const t = await startVendorThread(a.id, { subject: 'Pickup times', body: 'PRIVATE-BODY-1', by: 'alpha-user@example.com', now: at(0) });
      equal(sent.length, 1);                                                      // staff told
      assert(!/PRIVATE-BODY/.test(JSON.stringify(sent)), 'the email does not carry the message');
      await replyVendor(a.id, t.id, { body: 'more', by: 'alpha-user@example.com', now: at(5) });
      await replyVendor(a.id, t.id, { body: 'more', by: 'alpha-user@example.com', now: at(10) });
      equal(sent.length, 1);                                                      // chatty exchange: still one
      await replyVendor(a.id, t.id, { body: 'later', by: 'alpha-user@example.com', now: at(20) });
      equal(sent.length, 2);                                                      // 15 minutes on, another
      const before = sent.length;
      await replyStaff(t.id, { body: 'hello', by: 'rep@bargainbay.ca', now: at(21) });
      equal(sent.length, before + 2);                                             // vendor: contact email + owner user (both redirected)
      await replyStaff(t.id, { body: 'a second', by: 'rep@bargainbay.ca', now: at(22) });
      equal(sent.length, before + 2);                                             // throttled
      await replyStaff(t.id, { body: 'SECRET internal', internal: true, by: 'rep@bargainbay.ca', now: at(60) });
      equal(sent.length, before + 2);                                             // internal notes email nobody
      // mail failing: the write still happens, and the slot is handed back so the next message retries
      globalThis.fetch = async () => { throw new Error('network down'); };
      const r = await replyStaff(t.id, { body: 'while mail is down', by: 'rep@bargainbay.ca', now: at(90) });
      assert(r.ok);
      assert((await getVendorThread(a.id, t.id)).messages.some((m) => m.body === 'while mail is down'));
      const { rows } = await query('SELECT vendor_emailed_at FROM vendor_threads WHERE id = $1', [t.id]);
      assert(new Date(rows[0].vendor_emailed_at) < at(90), 'slot released after a failed send');
    });
  } finally { done(); }
});

test('wiring: nav item, home badge, staff tab, no attachments', async () => {
  const { readFileSync } = await import('node:fs');
  const f = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert(/key: 'messages'/.test(f('components/VendorNav.jsx')));
  assert(/vendorUnreadCount/.test(f('app/vendor/page.jsx')));
  assert(/tab === 'messages'/.test(f('components/AdminMarketplace.jsx')));
  assert(!/attachment|upload|blob/i.test(f('lib/vendor-messages.js').replace(/no attachments[^\n]*/gi, '')), 'text only');
});
