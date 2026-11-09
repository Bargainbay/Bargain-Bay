// lib/referral-partners.js — a partner is paid a % of PROFIT on every order their clients place.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertCustomer } from '../lib/customers.js';
import { savePartner, invitePartner, ensureCode, attachPartnerByCode, recordPayment, voidPayment, statementFor, statementCsv, requestForClient, recordVisit, getPartner, addTeamMember, removeTeamMember, listTeam, attachPartnerForOrder, partnerByCouponCode, ensureCustomerCoupon, customerLink, setClientPartner, partnerReport, revokePartner } from '../lib/referral-partners.js';

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

test('the sign-up link: a code per partner, a new account lands under them, nobody already placed is moved, a revoked code does nothing', async () => {
  const { done } = await withTestDb();
  try {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-test-secret-test-secret-1234';
    await savePartner({ email: JAY, name: 'Jayson Smith', pct: 10 }, OWNER);
    await savePartner({ email: 'jayson2@x.ca', name: 'Jayson Other', pct: 10 }, OWNER);
    const code = await ensureCode(JAY), code2 = await ensureCode('jayson2@x.ca');
    equal(code, 'jayson'); equal(code2, 'jayson2'); equal(await ensureCode(JAY), 'jayson');
    assert((await partnerReport(JAY)).partner.link.endsWith('/join/jayson'), 'link on the report');

    const r = await attachPartnerByCode('JAYSON', { email: 'new@x.ca', name: 'New Client' });
    assert(r.attached, 'attached'); equal(r.partner, JAY);
    equal((await partnerReport(JAY)).clients.map((c) => c.email).join(), 'new@x.ca');

    // someone already under another partner is not moved by a later link
    const c = await upsertCustomer({ email: 'placed@x.ca', name: 'Placed' });
    await setClientPartner(c, 'jayson2@x.ca', 'theirs', OWNER);
    assert(!(await attachPartnerByCode('jayson', { email: 'placed@x.ca', name: 'Placed' })).attached, 'not moved');
    equal((await query(`SELECT partner_email FROM customers WHERE id = $1`, [c])).rows[0].partner_email, 'jayson2@x.ca');

    assert(!(await attachPartnerByCode('nope', { email: 'z@x.ca' })).attached, 'unknown code');
    await revokePartner(JAY, OWNER);
    assert(!(await attachPartnerByCode('jayson', { email: 'late@x.ca' })).attached, 'revoked code');
  } finally { done(); }
});


suite('referral partners — part 2');

test('earned only once delivered and paid; payments reduce the balance; a void gives it back', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'Jayson', pct: 10 }, OWNER);
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    await setClientPartner(c, JAY, 'client', OWNER);
    await order('roger@x.ca', { price: 1000, cost: 600, status: 'delivered' });   // 40 earned
    await order('roger@x.ca', { price: 1000, cost: 600, status: 'ready' });       // 40 pending
    await order('roger@x.ca', { price: 1000, cost: 600, status: 'delivered' });   // delivered but still owing: pending
    await query(`INSERT INTO invoices (number, email, status, subtotal, total, order_id) VALUES ('INV-O1','roger@x.ca','open',1000,1000,(SELECT max(id) FROM orders))`);
    let r = await partnerReport(JAY);
    equal(r.totals.commission, 120); equal(r.totals.earned, 40); equal(r.totals.pending, 80); equal(r.totals.balance, 40);
    const pay = await recordPayment({ partnerEmail: JAY, amount: 25, paidOn: '2026-11-10', method: 'e-transfer', reference: 'R1' }, OWNER);
    r = await partnerReport(JAY);
    equal(r.totals.paid, 25); equal(r.totals.balance, 15); equal(r.payments.length, 1);
    await voidPayment(pay.id, OWNER);
    r = await partnerReport(JAY);
    equal(r.totals.paid, 0); equal(r.totals.balance, 40); equal(r.payments.length, 0);
    assert(await rejects(() => recordPayment({ partnerEmail: JAY, amount: 0 }, OWNER), 'amount'), 'amount required');
    assert(await rejects(() => recordPayment({ partnerEmail: 'nobody@x.ca', amount: 5 }, OWNER), 'nopartner'), 'partners only');
  } finally { done(); }
});

test('funnel, contact details and the monthly statement', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'Jayson', pct: 10 }, OWNER);
    await attachPartnerByCode('jayson', { email: 'a@x.ca', name: 'A Client', phone: '4165550101' });
    await attachPartnerByCode('jayson', { email: 'b@x.ca', name: 'B Client' });
    await query(`INSERT INTO users (email, name, password_hash, member_status) VALUES ('a@x.ca','A','x','approved'), ('b@x.ca','B','x','pending')`);
    await order('a@x.ca', { price: 1000, cost: 500, status: 'delivered' });
    await recordPayment({ partnerEmail: JAY, amount: 50, paidOn: new Date().toISOString().slice(0, 10) }, OWNER);
    const r = await partnerReport(JAY);
    equal(r.funnel.signedUp, 2); equal(r.funnel.applied, 2); equal(r.funnel.approved, 1);
    const a = r.clients.find((c) => c.email === 'a@x.ca');
    equal(a.phone, '4165550101'); equal(a.membership, 'approved');
    const st = statementFor(r, new Date().toISOString().slice(0, 7));
    equal(st.orders.length, 1); equal(st.totals.commission, 50); equal(st.totals.paid, 50); equal(st.balance, 0);
    const csv = statementCsv(r, st);
    assert(csv.includes('BB-P') && csv.includes('Balance owed'), 'csv has the orders and the balance');
    equal(statementFor(r, '2020-01').orders.length, 0);
  } finally { done(); }
});

test('a client request becomes an unassigned follow-up, only for the partner\'s own clients', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'Jayson', pct: 10 }, OWNER);
    const mine = await upsertCustomer({ email: 'mine@x.ca', name: 'Mine' });
    const theirs = await upsertCustomer({ email: 'theirs@x.ca', name: 'Theirs' });
    await setClientPartner(mine, JAY, 'client', OWNER);
    await requestForClient(JAY, mine, 'Two fridges for a rental, by Friday');
    const t = (await query(`SELECT title, owner_email, created_by FROM customer_tasks WHERE customer_id = $1`, [mine])).rows;
    equal(t.length, 1); equal(t[0].owner_email, null); equal(t[0].created_by, JAY);
    assert(await rejects(() => requestForClient(JAY, theirs, 'Something else entirely'), 'notfound'), 'not their client');
    assert(await rejects(() => requestForClient(JAY, mine, 'x'), 'note'), 'needs a note');
  } finally { done(); }
});

test('link visits count people, not page loads, and ignore bots', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'Jayson', pct: 10 }, OWNER);
    await ensureCode(JAY);
    await recordVisit('jayson', 'v1', 'Mozilla/5.0'); await recordVisit('jayson', 'v1', 'Mozilla/5.0'); await recordVisit('jayson', 'v2', 'Mozilla/5.0');
    await recordVisit('jayson', 'v3', 'facebookexternalhit/1.1'); await recordVisit('nope', 'v4', 'Mozilla/5.0');
    const r = await partnerReport(JAY);
    equal(r.visits.total, 2); equal(r.visits.recent, 2);
  } finally { done(); }
});

test('SecondShop: team logins see the organisation, can be removed, and cannot clash', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'SecondShop', pct: 10 }, OWNER);
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    await setClientPartner(c, JAY, 'client', OWNER);
    const added = await addTeamMember(JAY, { email: 'Amy@SecondShop.ca', name: 'Amy' }, OWNER);
    assert(added.ok && added.accountCreated, 'a new login is created for the teammate');
    const amy = await getPartner('amy@secondshop.ca');
    equal(amy.email, JAY, 'a teammate resolves to the organisation');
    const r = await partnerReport('amy@secondshop.ca');
    equal(r.clients.length, 1, 'the teammate sees the same clients');
    equal((await listTeam(JAY)).length, 2);
    assert(await rejects(() => addTeamMember(JAY, { email: JAY }, OWNER), 'primary'), 'the main login is not a teammate');
    await savePartner({ email: 'other@x.ca', name: 'Other', pct: 10 }, OWNER);
    assert(await rejects(() => addTeamMember('other@x.ca', { email: 'amy@secondshop.ca' }, OWNER), 'teammate'), 'one team per person');
    assert(await rejects(() => savePartner({ email: 'amy@secondshop.ca', pct: 10 }, OWNER), 'teammate'), 'a teammate cannot also be a partner');
    await removeTeamMember(JAY, 'amy@secondshop.ca', OWNER);
    equal(await getPartner('amy@secondshop.ca'), null, 'a removed teammate is locked out');
  } finally { done(); }
});

test('SecondShop: the end-user link carries a 5% code; ordering with it puts the buyer under the partner', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: JAY, name: 'SecondShop', pct: 10 }, OWNER);
    const r = await partnerReport(JAY);
    equal(r.partner.code, 'secondshop');
    equal(r.partner.customerCode, 'SECONDSHOP5');
    assert(r.partner.customerLink.endsWith('/join/secondshop/shop') && r.partner.link.endsWith('/join/secondshop'), 'two different links');
    const { rows } = await query(`SELECT kind, value::float8 AS value, commission_pct::float8 AS pct, active FROM coupons WHERE upper(code) = 'SECONDSHOP5'`);
    equal(rows[0].kind, 'percent'); equal(rows[0].value, 5); equal(rows[0].pct, 0); assert(rows[0].active);
    equal((await partnerByCouponCode('secondshop5')).email, JAY);
    const a = await attachPartnerForOrder({ couponCode: 'SECONDSHOP5', email: 'shopper@x.ca', name: 'Shopper' });
    assert(a.attached, 'the buyer is put under the partner');
    await order('shopper@x.ca', { price: 1000, cost: 600, discount: 50 });          // profit AFTER the 5% = 350 -> 35
    equal((await partnerReport(JAY)).totals.commission, 35);
    const again = await attachPartnerForOrder({ couponCode: 'SECONDSHOP5', email: 'shopper@x.ca' });
    assert(!again.attached, 'never moved or attached twice');
    // the percentage is editable; 0 switches the code off
    await savePartner({ email: JAY, pct: 10, customerPct: 0 }, OWNER);
    equal(await ensureCustomerCoupon(JAY), null);
    equal((await query(`SELECT active FROM coupons WHERE upper(code) = 'SECONDSHOP5'`)).rows[0].active, false);
    await savePartner({ email: JAY, pct: 10, customerPct: 7 }, OWNER);
    equal(await ensureCustomerCoupon(JAY), 'SECONDSHOP7');
  } finally { done(); }
});
