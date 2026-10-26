// Affiliates: the code is a coupon, the commission is read off the sales, and
// money only goes out once an order is delivered and its return window has closed.
import { suite, test, assert, equal } from './_harness.mjs';
import { AFFILIATE_TERMS_VERSION } from '../lib/affiliate-terms.js';
import { withTestDb } from './db.mjs';
import { ensureCouponSchema, redeemCouponWithClient, validateCoupon } from '../lib/coupons.js';
import {
  applyAsAffiliate, approveAffiliate, setAffiliateStatus, affiliateSales, dashboardFor, recordPayout, listAffiliates, setPayoutEmail
} from '../lib/affiliates.js';

async function rejects(fn, msg = 'should have been refused') {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  assert(threw, msg);
}

async function fresh() {
  const db = await withTestDb();
  await ensureCouponSchema();
  return db;
}
const session = { email: 'dave@promo.ca', name: 'Dave Promo' };
const apply = (s = session) => applyAsAffiliate(s, { name: s.name, payoutEmail: 'dave.pay@promo.ca', audience: 'A Facebook group of 4,000 Durham landlords.', acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION });
let n = 100;
// A sale through the affiliate's code. `daysAgoDelivered` null = not delivered.
async function sale(client, aff, { goods, discount = 0, status = 'confirmed', daysAgoDelivered = null, buyer = 'buyer@x.ca' }) {
  n += 1;
  const { rows } = await client.query(
    `INSERT INTO orders (order_number, email, name, status, subtotal, discount, total, hst, delivered_at)
     VALUES ($1,$2,'B',$3,$4,$5,$4,0, ${daysAgoDelivered == null ? 'NULL' : `now() - interval '${daysAgoDelivered} days'`}) RETURNING id`,
    [`BB-A${n}`, buyer, status, goods, discount]);
  await client.query(`INSERT INTO order_items (order_id, sku, title, price, kind) VALUES ($1,$2,'Range',$3,'unit')`, [rows[0].id, `S${n}`, goods]);
  await client.query('BEGIN');
  await redeemCouponWithClient(client, { id: aff.couponId, code: aff.code, affiliate: aff.name, commissionPct: aff.commissionPct }, { orderId: rows[0].id, email: buyer, subtotal: goods, discount });
  await client.query('COMMIT');
  return rows[0].id;
}

suite('affiliate approval');
test('applying needs a payout address, a plan and the terms; the email is the account’s', async () => {
  const { done } = await fresh();
  try {
    await rejects(() => applyAsAffiliate(session, { name: 'Dave', payoutEmail: 'nope', audience: 'long enough audience text', acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION }));
    await rejects(() => applyAsAffiliate(session, { name: 'Dave', payoutEmail: 'a@b.ca', audience: 'short', acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION }));
    await rejects(() => applyAsAffiliate(session, { name: 'Dave', payoutEmail: 'a@b.ca', audience: 'long enough audience text', acceptTerms: false }));
    const r = await apply();
    equal(r.affiliate.status, 'pending'); equal(r.affiliate.email, 'dave@promo.ca');
    assert((await apply()).created === false, 'applying twice is one application');
  } finally { done(); }
});
test('THE APPLICANT MUST HAVE ACCEPTED THE CURRENT VERSION OF THE AGREEMENT', async () => {
  const { done } = await fresh();
  try {
    const base = { name: 'Dave', payoutEmail: 'a@b.ca', audience: 'long enough audience text', acceptTerms: true };
    await rejects(() => applyAsAffiliate(session, base), 'no version sent');
    await rejects(() => applyAsAffiliate(session, { ...base, termsVersion: '2020-01-01' }), 'an old version');
    const r = await applyAsAffiliate(session, { ...base, termsVersion: AFFILIATE_TERMS_VERSION });
    equal(r.affiliate.status, 'pending');
    const { rows } = await (await import('../lib/db.js')).query('SELECT terms_version, terms_accepted_at FROM affiliates');
    equal(rows[0].terms_version, AFFILIATE_TERMS_VERSION);
    assert(rows[0].terms_accepted_at, 'the time of acceptance is recorded');
  } finally { done(); }
});
test('approving cuts a working coupon code at 5% commission', async () => {
  const { done } = await fresh();
  try {
    const { affiliate } = await apply();
    const a = await approveAffiliate(affiliate.id, {}, { email: 'owner@x.ca' });
    equal(a.status, 'approved'); equal(a.commissionPct, 5); equal(a.code, 'DAVE');
    const ok = await validateCoupon('dave', { subtotal: 1000 });
    assert(ok.ok, 'the code works at checkout'); equal(ok.coupon.commissionPct, 5);
    // A second Dave gets a different code, not a collision.
    const b = (await applyAsAffiliate({ email: 'dave2@x.ca', name: 'Dave Two' }, { name: 'Dave Two', payoutEmail: 'd2@x.ca', audience: 'Word of mouth in my building.', acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION })).affiliate;
    equal((await approveAffiliate(b.id)).code, 'DAVE2');
    // Suspending switches the code off; the history stays.
    await setAffiliateStatus(affiliate.id, 'suspend');
    assert(!(await validateCoupon('DAVE', { subtotal: 1000 })).ok, 'a suspended code stops working');
    await setAffiliateStatus(affiliate.id, 'reinstate');
    assert((await validateCoupon('DAVE', { subtotal: 1000 })).ok);
  } finally { done(); }
});

suite('affiliate commission');
test('A $10,000 STOVE PAYS $500, AND ONLY WHEN DELIVERED AND PAST THE RETURN WINDOW', async () => {
  const { client, done } = await fresh();
  try {
    const { affiliate } = await apply();
    const a = await approveAffiliate(affiliate.id);
    await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });   // payable
    await sale(client, a, { goods: 2000, status: 'delivered', daysAgoDelivered: 3 });     // in the window
    await sale(client, a, { goods: 1000, status: 'confirmed' });                          // not delivered
    await sale(client, a, { goods: 4000, status: 'cancelled' });                          // void
    const d = await dashboardFor(session);
    equal(d.summary.payable, 500); equal(d.summary.hold, 100); equal(d.summary.waiting, 50);
    equal(d.summary.balance, 500); equal(d.summary.sales, 3);
    const states = d.sales.map((s) => s.state).sort();
    equal(states.join(), ['hold', 'payable', 'void', 'waiting'].join());
  } finally { done(); }
});
test('commission is on the goods after the code’s discount, never on delivery or tax', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    await sale(client, a, { goods: 1000, discount: 100, status: 'delivered', daysAgoDelivered: 30 });
    const [s] = await affiliateSales(a.id);
    equal(s.base, 900); equal(s.commission, 45);
  } finally { done(); }
});
test('the rate in force when the code was used is the rate that sale earns', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    await sale(client, a, { goods: 1000, status: 'delivered', daysAgoDelivered: 30 });
    await approveAffiliate(a.id, { pct: 10 });                    // raised afterwards
    await sale(client, { ...a, commissionPct: 10 }, { goods: 1000, status: 'delivered', daysAgoDelivered: 30 });
    const sales = await affiliateSales(a.id);
    equal(sales.map((s) => s.commission).sort((x, y) => x - y).join(), '50,100');
  } finally { done(); }
});
test('NOBODY EARNS COMMISSION ON THEIR OWN ORDER', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    await sale(client, a, { goods: 5000, status: 'delivered', daysAgoDelivered: 30, buyer: 'Dave@Promo.ca' });
    await sale(client, a, { goods: 5000, status: 'delivered', daysAgoDelivered: 30, buyer: 'dave.pay@promo.ca' });
    const d = await dashboardFor(session);
    equal(d.summary.payable, 0); equal(d.sales.every((s) => s.own && s.commission === 0), true);
  } finally { done(); }
});

suite('affiliate payouts');
test('a payout is capped at what is payable, can’t be doubled by reference, and brings the balance down', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });  // $500
    await sale(client, a, { goods: 4000, status: 'confirmed' });                          // $200 not yet payable
    await rejects(() => recordPayout(a.id, { amount: 600 }), 'more than is payable');
    await rejects(() => recordPayout(a.id, { amount: 0 }));
    const r = await recordPayout(a.id, { amount: 300, ref: 'ET-1' }, { email: 'owner@x.ca' });
    equal(r.balance, 200);
    await rejects(() => recordPayout(a.id, { amount: 100, ref: 'et-1' }), 'same reference twice');
    await recordPayout(a.id, { amount: 200, ref: 'ET-2' });
    const d = await dashboardFor(session);
    equal(d.summary.balance, 0); equal(d.summary.paid, 500); equal(d.payouts.length, 2);
  } finally { done(); }
});
test('a refund after payout leaves the balance negative and nets off the next one', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    const id = await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });
    await recordPayout(a.id, { amount: 500, ref: 'ET-9' });
    await client.query(`UPDATE orders SET status='refunded' WHERE id=$1`, [id]);
    equal((await dashboardFor(session)).summary.balance, -500);
    const list = await listAffiliates();
    equal(list[0].summary.balance, -500);
  } finally { done(); }
});
test('an affiliate sees only their own record and can change only where they are paid', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    await sale(client, a, { goods: 1000, status: 'delivered', daysAgoDelivered: 30 });
    const other = await dashboardFor({ email: 'stranger@x.ca' });
    equal(other.affiliate, null);
    await setPayoutEmail(session, 'new.pay@promo.ca');
    equal((await dashboardFor(session)).affiliate.payoutEmail, 'new.pay@promo.ca');
    const d = await dashboardFor(session);
    assert(!JSON.stringify(d).includes('buyer@x.ca'), 'no customer details are in an affiliate’s data');
  } finally { done(); }
});

// ---- email, visits, and the payout run --------------------------------------
import { recordClick, clickStats, payoutRun, payoutRunCsv, recordPayoutRun } from '../lib/affiliates.js';

// Run `fn` as production with Resend stubbed, returning every email "sent".
async function withMail(fn) {
  const keys = ['VERCEL_ENV', 'RESEND_API_KEY', 'STAGING_EMAIL_TO', 'ALLOW_REAL_OUTBOUND'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch; const sent = [];
  try {
    process.env.VERCEL_ENV = 'production'; process.env.RESEND_API_KEY = 're_test';
    globalThis.fetch = async (url, init) => { try { sent.push(JSON.parse(init.body)); } catch { /* not a mail call */ } return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }; };
    await fn(sent);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

suite('affiliate emails');
test('APPROVAL EMAILS THEM ONCE, WITH THEIR CODE; RE-EDITING AN APPROVED AFFILIATE DOES NOT RESEND', async () => {
  const { done } = await fresh();
  try {
    await withMail(async (sent) => {
      const { affiliate } = await apply();
      const toOffice = sent.filter((m) => /New affiliate application/.test(m.subject));
      equal(toOffice.length, 1, 'the office hears about the application');
      const a = await approveAffiliate(affiliate.id, {}, { email: 'owner@x.ca' });
      const welcome = sent.filter((m) => /approved/.test(m.subject));
      equal(welcome.length, 1);
      assert(JSON.stringify(welcome[0].to).includes('dave@promo.ca'), 'goes to the applicant');
      assert(welcome[0].html.includes(a.code) && welcome[0].html.includes('ref=' + a.code), 'carries the code and the link');
      await approveAffiliate(affiliate.id, { pct: 6 });
      equal(sent.filter((m) => /approved/.test(m.subject)).length, 1, 'an edit is not a second welcome');
    });
  } finally { done(); }
});
test('a payout emails the affiliate at their PAYOUT address', async () => {
  const { client, done } = await fresh();
  try {
    await withMail(async (sent) => {
      const a = await approveAffiliate((await apply()).affiliate.id);
      await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });
      await recordPayout(a.id, { amount: 500, ref: 'ET-5' });
      const m = sent.find((x) => /commission/i.test(x.subject) && /sent/.test(x.subject));
      assert(m, 'a payout email was sent');
      assert(JSON.stringify(m.to).includes('dave.pay@promo.ca'));
      assert(m.html.includes('$500.00') && m.html.includes('ET-5'));
    });
  } finally { done(); }
});
test('a mail failure never undoes an approval or a recorded payout', async () => {
  const { client, done } = await fresh();
  const realFetch = globalThis.fetch;
  const keys = ['VERCEL_ENV', 'RESEND_API_KEY']; const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.VERCEL_ENV = 'production'; process.env.RESEND_API_KEY = 're_test';
    globalThis.fetch = async () => { throw new Error('resend down'); };
    const a = await approveAffiliate((await apply()).affiliate.id);
    equal(a.status, 'approved');
    await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });
    equal((await recordPayout(a.id, { amount: 500 })).paid, 500);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    done();
  }
});

suite('affiliate visits');
test('ONE VISITOR, ONE DAY, ONE VISIT - and bots, strangers and unapproved codes count for nothing', async () => {
  const { done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    equal(await recordClick(a.code, 'visitor-aaaa1111'), true);
    await recordClick(a.code, 'visitor-aaaa1111');                  // refresh
    await recordClick(a.code.toLowerCase(), 'visitor-bbbb2222');
    equal(await recordClick(a.code, 'visitor-cccc3333', 'Googlebot/2.1'), false, 'a crawler');
    equal(await recordClick('NOSUCHCODE', 'visitor-dddd4444'), false, 'a code nobody has');
    equal(await recordClick(a.code, 'x'), false, 'a junk visitor id');
    const s = await clickStats(a.id);
    equal(s.visitors, 2); equal(s.visits, 2);
    await setAffiliateStatus(a.id, 'suspend');
    equal(await recordClick(a.code, 'visitor-eeee5555'), false, 'a suspended code is not counted');
  } finally { done(); }
});

suite('affiliate payout run');
test('THE RUN LISTS ONLY WHAT IS PAYABLE AND OVER THE MINIMUM; RECORDING IT TWICE PAYS NOBODY TWICE', async () => {
  const { client, done } = await fresh();
  try {
    const a = await approveAffiliate((await apply()).affiliate.id);
    const b = await approveAffiliate((await applyAsAffiliate({ email: 'small@x.ca', name: 'Small Fry' }, { name: 'Small Fry', payoutEmail: 'sf@x.ca', audience: 'My street group chat.', acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION })).affiliate.id);
    await sale(client, a, { goods: 10000, status: 'delivered', daysAgoDelivered: 20 });   // $500
    await sale(client, a, { goods: 5000, status: 'confirmed' });                          // not yet
    await sale(client, b, { goods: 600, status: 'delivered', daysAgoDelivered: 20 });     // $30: under the $50 minimum
    const run = await payoutRun();
    equal(run.rows.length, 1); equal(run.rows[0].name, 'Dave Promo'); equal(run.total, 500);
    const csv = payoutRunCsv([{ name: '=cmd|x', payoutEmail: 'a@b.ca', amount: 12.5, ref: 'R' }, { name: 'Smith, J', payoutEmail: 'j@b.ca', amount: 60, ref: 'R2' }]);
    assert(csv.includes("'=cmd|x"), 'formula neutralised'); assert(csv.includes('"Smith, J"'), 'comma quoted');
    const r1 = await recordPayoutRun({ email: 'owner@x.ca' });
    equal(r1.recorded.length, 1); equal(r1.total, 500);
    const r2 = await recordPayoutRun({ email: 'owner@x.ca' });
    equal(r2.recorded.length, 0, 'nothing left to pay, so the second press pays nobody');
    equal((await dashboardFor(session)).summary.balance, 0);
  } finally { done(); }
});
