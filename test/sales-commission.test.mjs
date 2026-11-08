// lib/sales-commission.js — Collected Sales and the weekly statement, against a real database.
//
// The rules under test are the Employment Agreement's (4.2–4.8) and Addendum 1:
//   · counted before HST, on the Toronto day the payment arrived, parts NOT deducted;
//   · an account the rep brought in counts on any day; on an In-house day (a shop clock-in) a deal the rep
//     personally closed THAT day counts whoever owned the lead; a Mobile Day for somebody else's customer does not;
//   · a liquidation partner's sale counts only RS Solutions' own cut;
//   · a refund is a negative adjustment in the week it happened, never a rewrite of a past week;
//   · an approved week is frozen.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertCustomer } from '../lib/customers.js';
import { createLead, getLead, convertLead } from '../lib/leads.js';
import {
  setRepPlan, history, weekOf, statementFor, approveStatement, markStatementPaid, statementCsv, repToday, dayReport,
  clockIn, clockOut, openShift, fixShift, addShift, setCustomerOwner, setVendorSourcedBy, setTiers, weekStartOf, addDays, workingDaysBetween
} from '../lib/sales-commission.js';

const JOHN = 'john@rssolutions.ca';
const OWNER = 'owner@rssolutions.ca';
const WEEK = '2026-10-05';           // a Monday, safely in the past
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };
const at = (day, time = '15:00') => `${day} ${time}:00-04`;   // October is EDT

let seq = 0;
/** An invoice with its own subtotal/HST, raised by `by` on `createdDay`; payments are [day, gross]. */
async function invoice({ email, by = OWNER, createdDay, subtotal, hst = 0, pays = [], status = 'paid' }) {
  seq += 1;
  const total = subtotal + hst;
  const { rows } = await query(
    `INSERT INTO invoices (number, email, name, status, subtotal, hst, total, created_by, created_at)
     VALUES ($1,$2,'C',$3,$4,$5,$6,$7,$8) RETURNING id`, [`INV-T${seq}`, email, status, subtotal, hst, total, by, at(createdDay, '09:00')]);
  for (const [day, gross, method = 'etransfer'] of pays) {
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES ($1,$2,$3,$4)`, [rows[0].id, gross, method, at(day)]);
  }
  return rows[0].id;
}
const customer = async (email, owner = null) => {
  const id = await upsertCustomer({ email, name: email.split('@')[0] });
  if (owner) await query(`UPDATE customers SET owner_email = $2 WHERE id = $1`, [id, owner]);
  return id;
};
const setup = async () => { await setRepPlan(JOHN, { startDate: WEEK, quota: 150000, quotaDays: 30 }, OWNER); };
const net = async (day) => (await history(JOHN, addDays(WEEK, 30))).days.find((d) => d.day === day)?.net ?? 0;

suite('collected sales — what counts');

test('before HST: a $1,130 payment on a 13% invoice is $1,000; parts are NOT deducted', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-06', subtotal: 3000, hst: 390, pays: [['2026-10-06', 3390]] });   // a $3,000 repair that had $300 of parts
    equal(await net('2026-10-06'), 3000);
  } finally { await done(); }
});

test('a payment is counted on the Toronto day it arrived, a partial payment pro rata', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-06', subtotal: 1000, hst: 130, pays: [['2026-10-06', 565], ['2026-10-08', 565]], status: 'paid' });
    equal(await net('2026-10-06'), 500); equal(await net('2026-10-08'), 500);
    // 11pm Toronto is still that day, even though it is already the next day in UTC
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-07', subtotal: 100, pays: [] });
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES ((SELECT max(id) FROM invoices), 100, 'cash', '2026-10-07 23:30:00-04')`);
    equal(await net('2026-10-07'), 100);
  } finally { await done(); }
});

test('an Employee Account counts on any day, Mobile or not, for as long as they are on the plan', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', by: OWNER, createdDay: '2026-10-06', subtotal: 2000, pays: [['2026-10-06', 2000]] });
    await invoice({ email: 'mine@x.ca', by: OWNER, createdDay: '2027-12-20', subtotal: 500, pays: [] });
    await query(`INSERT INTO invoice_payments (invoice_id, amount, method, paid_at) VALUES ((SELECT max(id) FROM invoices), 500, 'etransfer', '2027-12-21 15:00:00-05')`);
    const h = await history(JOHN, '2028-01-31');
    equal(h.days.map((d) => d.net).join(), '2000,500', 'a repeat order 14 months later still counts');
  } finally { await done(); }
});

test('somebody else’s customer on a Mobile Day: $0. The same sale on an In-house Day he closed: counts', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('walkin@x.ca', null); await customer('owners@x.ca', OWNER);
    await invoice({ email: 'owners@x.ca', by: JOHN, createdDay: '2026-10-06', subtotal: 2000, pays: [['2026-10-06', 2000]] });
    equal(await net('2026-10-06'), 0, 'mobile day, not his account');
    await addShift(JOHN, { startedAt: at('2026-10-07', '08:30') }, OWNER);                     // clocked in at the shop on the 7th
    await invoice({ email: 'owners@x.ca', by: JOHN, createdDay: '2026-10-07', subtotal: 2000, pays: [['2026-10-07', 2000]] });
    equal(await net('2026-10-07'), 2000, 'in-house day, he closed it that day, whoever owned the lead');
    await invoice({ email: 'owners@x.ca', by: OWNER, createdDay: '2026-10-07', subtotal: 900, pays: [['2026-10-07', 900]] });
    equal(await net('2026-10-07'), 2000, 'a deal the OWNER closed does not count, even on an in-house day');
    await invoice({ email: 'owners@x.ca', by: JOHN, createdDay: '2026-10-07', subtotal: 700, pays: [['2026-10-09', 700]] });
    equal(await net('2026-10-09'), 0, 'his deal, but the money arrived on a Mobile Day for a customer who is not his');
  } finally { await done(); }
});

test('a liquidation partner’s sale counts only RS Solutions’ 10% cut', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const v = (await query(`INSERT INTO vendors (slug, legal_name, trade_name, contact_email, sourced_by_email) VALUES ('acme','Acme Inc','Acme','a@acme.ca',$1) RETURNING id`, [JOHN])).rows[0].id;
    await query(`INSERT INTO vendor_ledger (vendor_id, kind, amount_cents, order_ref, at, idem_key) VALUES ($1,'commission',-20000,'BB-1',$2,'k1')`, [v, at('2026-10-06')]);   // 10% of a $2,000 sale
    const other = (await query(`INSERT INTO vendors (slug, legal_name, contact_email) VALUES ('zed','Zed Inc','z@zed.ca') RETURNING id`)).rows[0].id;
    await query(`INSERT INTO vendor_ledger (vendor_id, kind, amount_cents, order_ref, at, idem_key) VALUES ($1,'commission',-50000,'BB-2',$2,'k2')`, [other, at('2026-10-06')]);
    equal(await net('2026-10-06'), 200, 'only the partner he sourced, and only our cut');
  } finally { await done(); }
});

suite('commission — the week, refunds, approval');

test('the weekly total is the sum of each day’s commission; the cliff applies to the whole day', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    for (const [day, amt] of [['2026-10-05', 9000], ['2026-10-06', 15000], ['2026-10-07', 25000]]) {
      await invoice({ email: 'mine@x.ca', createdDay: day, subtotal: amt, pays: [[day, amt]] });
    }
    const w = weekOf(await history(JOHN, '2026-10-11'), WEEK);
    equal(w.days.map((d) => d.commission).slice(0, 3), [0, 150, 375]);
    equal(w.commission, 525); equal(w.total, 525); equal(w.collected, 49000);
  } finally { await done(); }
});

test('a refund after the fact is a negative adjustment in the week it happened, and the past week does not move', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    const inv = await invoice({ email: 'mine@x.ca', createdDay: '2026-10-06', subtotal: 15000, pays: [['2026-10-06', 15000]] });
    await query(`INSERT INTO invoice_refunds (invoice_id, amount, kind, created_at) VALUES ($1, 6000, 'amount', $2)`, [inv, at('2026-10-14')]);   // the following week
    const hist = await history(JOHN, '2026-10-18');
    const w1 = weekOf(hist, WEEK); const w2 = weekOf(hist, '2026-10-12');
    equal(w1.total, 150, 'the week it was earned still shows what was earned');
    equal(w2.adjustments.length, 1); equal(w2.adjustments[0].amount, -150, 'the day fell from $15,000 to $9,000, under the line: the whole $150 comes back');
    equal(w2.total, -150);
    // a smaller refund that keeps the day over the line only takes 1% of itself back
    const inv2 = await invoice({ email: 'mine@x.ca', createdDay: '2026-10-20', subtotal: 15000, pays: [['2026-10-20', 15000]] });
    await query(`INSERT INTO invoice_refunds (invoice_id, amount, kind, created_at) VALUES ($1, 1000, 'amount', $2)`, [inv2, at('2026-10-21')]);
    const h2 = await history(JOHN, '2026-10-25');
    equal(weekOf(h2, '2026-10-19').adjustments[0].amount, -10);
  } finally { await done(); }
});

test('a refund on an invoice that earned the rep nothing costs the rep nothing', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('theirs@x.ca', OWNER);
    const inv = await invoice({ email: 'theirs@x.ca', by: OWNER, createdDay: '2026-10-06', subtotal: 20000, pays: [['2026-10-06', 20000]] });
    await query(`INSERT INTO invoice_refunds (invoice_id, amount, kind, created_at) VALUES ($1, 5000, 'amount', $2)`, [inv, at('2026-10-08')]);
    equal((await history(JOHN, '2026-10-11')).adjustments.length, 0);
  } finally { await done(); }
});

test('approving: only once the week is over; once only; frozen against later changes; then paid', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-06', subtotal: 15000, pays: [['2026-10-06', 15000]] });
    const future = weekStartOf(addDays(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), 0));
    assert(await rejects(() => approveStatement(JOHN, future, OWNER), 'open-week'), 'this week is not over');
    equal((await statementFor(JOHN, WEEK)).status, 'draft');
    const s = await approveStatement(JOHN, WEEK, OWNER);
    equal(s.total, 150); equal((await statementFor(JOHN, WEEK)).status, 'approved');
    assert(await rejects(() => approveStatement(JOHN, WEEK, OWNER), 'exists'));
    // a payment arrives late and is back-dated into the approved week: the approved figure stands and the drift is shown
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-07', subtotal: 12000, pays: [['2026-10-07', 12000]] });
    const after = await statementFor(JOHN, WEEK);
    equal(after.total, 150, 'frozen'); equal(after.drift, 120, 'and the drift is visible to the owner');
    await markStatementPaid(JOHN, WEEK, OWNER);
    equal((await statementFor(JOHN, WEEK)).status, 'paid');
    assert(await rejects(() => markStatementPaid(JOHN, WEEK, OWNER), 'state'));
  } finally { await done(); }
});

test('a person with no plan has no commission, and CSV cells cannot run as formulas', async () => {
  const { done } = await withTestDb();
  try {
    equal((await history('nobody@x.ca')).days.length, 0);
    equal(await repToday('nobody@x.ca'), null);
    await setup();
    const csv = statementCsv({ rep: '=HYPERLINK("x")', weekStart: WEEK, weekEnd: '2026-10-11', status: 'draft', days: [], adjustments: [], commission: 0, adjustmentsTotal: 0, total: 0 });
    assert(csv.includes(`"'=HYPERLINK(""x"")"`) || csv.includes("'=HYPERLINK"), 'a leading = is neutralised');
  } finally { await done(); }
});

suite('commission — today, the quota window, the clock');

test('today: the tier reached, how far to the next, and the pace needed to hit the quota', async () => {
  const { done } = await withTestDb();
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    await setRepPlan(JOHN, { startDate: today, quota: 150000, quotaDays: 30 }, OWNER);
    await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', createdDay: today, subtotal: 12000, pays: [[today, 12000]] });
    const t = await repToday(JOHN, today);
    equal(t.todayNet, 12000); equal(t.todayPct, 1); equal(t.todayCommission, 120);
    equal(t.next.pct, 1.5); equal(t.next.moreNeeded, 8000.01);
    equal(t.quota.collected, 12000); equal(t.quota.left, 138000);
    assert(t.quota.perDayNeeded > 0 && t.quota.workingDaysLeft > 0);
    equal(workingDaysBetween('2026-11-09', '2026-11-13'), 5); equal(workingDaysBetween('2026-11-14', '2026-11-15'), 0);
  } finally { await done(); }
});

test('the shop clock: one open shift at a time, today becomes In-house, an owner can fix it (logged)', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    await clockIn(JOHN);
    assert(await rejects(() => clockIn(JOHN), 'open'));
    assert(await openShift(JOHN));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    equal((await history(JOHN, today)).shopDays.includes(today), true);
    await clockOut(JOHN);
    assert(await rejects(() => clockOut(JOHN), 'closed'));
    const id = (await query(`SELECT id FROM rep_shifts LIMIT 1`)).rows[0].id;
    assert(await rejects(() => fixShift(id, { startedAt: '2026-10-07T10:00:00Z', endedAt: '2026-10-07T09:00:00Z' }, OWNER)));
    await fixShift(id, { startedAt: '2026-10-07T12:00:00Z', endedAt: '2026-10-07T20:00:00Z' }, OWNER);
    equal((await query(`SELECT edited_by FROM rep_shifts WHERE id = $1`, [id])).rows[0].edited_by, OWNER);
  } finally { await done(); }
});

suite('commission — whose account is it');

test('converting a NEW lead makes the rep its owner; an EXISTING customer is linked but never credited', async () => {
  const { done } = await withTestDb();
  try {
    const john = { email: JOHN, name: 'John Tobias', admin: false };
    const fresh = (await createLead({ company: 'Fresh Props', email: 'new@fresh.ca', phone: '416-555-0111' }, john)).id;
    const r = await convertLead(fresh, john);
    equal(r.existing, false); equal(r.ownsIt, true);
    equal((await query(`SELECT owner_email, owner_reason FROM customers WHERE id = $1`, [r.customerId])).rows[0].owner_email, JOHN);
    assert(await rejects(() => convertLead(fresh, john), 'converted'));
    equal((await getLead(fresh, john)).customer_id, r.customerId);

    await customer('old@buyer.ca', null);                                   // already a customer of ours
    const old = (await createLead({ company: 'Old Buyer', email: 'old@buyer.ca' }, john)).id;
    const r2 = await convertLead(old, john);
    equal(r2.existing, true); equal(r2.ownsIt, false);
    equal((await query(`SELECT owner_email FROM customers WHERE email = 'old@buyer.ca'`)).rows[0].owner_email, null, 'an existing customer is not his');
  } finally { await done(); }
});

test('assigning an account needs a written reason and is logged; so does a partner', async () => {
  const { done } = await withTestDb();
  try {
    const id = await customer('x@y.ca', null);
    assert(await rejects(() => setCustomerOwner(id, JOHN, '', OWNER), 'reason'));
    await setCustomerOwner(id, JOHN, 'John brought them in at the trade show', OWNER);
    equal((await query(`SELECT owner_email, owner_reason FROM customers WHERE id = $1`, [id])).rows[0].owner_email, JOHN);
    await setCustomerOwner(id, '', 'Not his after all', OWNER);
    equal((await query(`SELECT owner_email FROM customers WHERE id = $1`, [id])).rows[0].owner_email, null);
    const v = (await query(`INSERT INTO vendors (slug, legal_name, contact_email) VALUES ('q','Q Inc','q@q.ca') RETURNING id`)).rows[0].id;
    assert(await rejects(() => setVendorSourcedBy(v, JOHN, '', OWNER), 'reason'));
    await setVendorSourcedBy(v, JOHN, 'He signed them', OWNER);
    equal((await query(`SELECT sourced_by_email FROM vendors WHERE id = $1`, [v])).rows[0].sourced_by_email, JOHN);
    const n = (await query(`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'sales.%'`)).rows[0].n;
    assert(n >= 3, 'every change is in the audit log');
  } finally { await done(); }
});

test('the quota report: collected vs the target, with activity and pipeline', async () => {
  const { done } = await withTestDb();
  try {
    await setup(); await customer('mine@x.ca', JOHN);
    await invoice({ email: 'mine@x.ca', createdDay: '2026-10-06', subtotal: 60000, pays: [['2026-10-06', 60000]] });
    await setTiers([{ over: 10000, pct: 1 }, { over: 20000, pct: 1.5 }, { over: 30000, pct: 2 }], OWNER);
    const r = await dayReport(JOHN);
    equal(r.collected, 60000); equal(r.percent, 40); equal(r.met, false); equal(r.commission, 1200);
    equal(r.finished, true === (r.windowEnd < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })));
  } finally { await done(); }
});
