// lib/referral-partners.js — a partner is paid a % of PROFIT on every order their clients place.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertCustomer } from '../lib/customers.js';
import { savePartner, invitePartner, getPartner, setClientPartner, partnerReport, revokePartner } from '../lib/referral-partners.js';

const JAY = 'jdriver13@live.ca';
const OWNER = 'owner@x.ca';
let n = 0;
async function order(email, { price, cost, status = 'confirmed', discount = 0, kind = 'unit' }) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO orders (order_number, email, name, status, subtotal, discount, total, hst) VALUES ($1,$2,'C',$3,$4,$5,$4,0) RETURNING id`,
    [`BB-P${n}`, email, status, price, discount]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,$2,'Range',$3,$4,$5)`, [rows[0].id, `P${n}`, price, cost, kind]);
}
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };

suite('referral partners');

test('10% of the profit on each of a client\'s orders; other customers and cancelled orders earn nothing', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'Jayson', pct: 10 }, OWNER);
    const roger = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger Duffus' });
    await upsertCustomer({ email: 'other@x.ca', name: 'Other' });
    await setClientPartner(roger, JAY, 'Jayson\'s client', OWNER);
    await order('roger@x.ca', { price: 1000, cost: 600 });                       // profit 400 -> 40
    await order('roger@x.ca', { price: 500, cost: 600 });                        // a loss earns 0, never negative
    await order('roger@x.ca', { price: 900, cost: 100, status: 'cancelled' });   // not a sale
    await order('other@x.ca', { price: 2000, cost: 500 });                       // not his client
    const r = await partnerReport(JAY);
    equal(r.clients.length, 1);
    equal(r.clients[0].orders.length, 2);
    equal(r.totals.commission, 40);
    equal(r.totals.sales, 1500);
  } finally { done(); }
});

test('a unit with no cost counts as zero profit and is reported', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, pct: 10 }, OWNER);
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    await setClientPartner(c, JAY, 'client', OWNER);
    await order('roger@x.ca', { price: 1000, cost: null });
    const r = await partnerReport(JAY);
    equal(r.totals.commission, 0); equal(r.totals.missingCost, 1);
  } finally { done(); }
});

test('only an active partner can have clients; revoking removes access; a reason is required', async () => {
  const { done } = await withTestDb();
  try {
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    assert(await rejects(() => setClientPartner(c, JAY, 'x ok', OWNER), 'nopartner'), 'not a partner yet');
    await savePartner({ email: JAY, pct: 10 }, OWNER);
    assert(await rejects(() => setClientPartner(c, JAY, '', OWNER), 'reason'), 'reason needed');
    await setClientPartner(c, JAY, 'client', OWNER);
    assert(await getPartner(JAY), 'active');
    await revokePartner(JAY, OWNER);
    equal(await getPartner(JAY), null);
    equal((await partnerReport(JAY)).clients.length, 0);
    assert(await rejects(() => savePartner({ email: JAY, pct: 90 }, OWNER), 'pct'), 'pct capped');
  } finally { done(); }
});

test('adding a partner creates their account (no password they know) and gives a single-use invite link; re-saving does not duplicate it', async () => {
  const { done } = await withTestDb();
  try {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-test-secret-test-secret-1234';
    const first = await savePartner({ email: 'Jdriver13@Live.ca', name: 'Jayson', pct: 10 }, OWNER);
    assert(first.accountCreated, 'account created');
    assert(/reset-password\?token=/.test(first.link), 'invite link returned');
    const u = await query(`SELECT name FROM users WHERE email = 'jdriver13@live.ca'`);
    equal(u.rows.length, 1); equal(u.rows[0].name, 'Jayson');
    const again = await savePartner({ email: JAY, pct: 12 }, OWNER);
    assert(!again.accountCreated && !again.link, 'no second account, no second email');
    equal((await query(`SELECT 1 FROM users WHERE email = $1`, [JAY])).rows.length, 1);
    const resend = await invitePartner(JAY, OWNER);
    assert(resend.link, 'can send another invite');
    assert(await rejects(() => invitePartner('nobody@x.ca', OWNER), 'nopartner'), 'only partners');
  } finally { done(); }
});
