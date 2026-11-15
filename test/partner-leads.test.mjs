// Partner leads (phase 2): sending, the duplicate rule, what the sender is shown, and the queue our team claims from.
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';
import { upsertCustomer } from '../lib/customers.js';
import { savePartner, addTeamMember, getPartnerSeat } from '../lib/referral-partners.js';
import { submitLead, myLeads, orgOverview, claimLead, partnerLeadQueue, notifyTeamOfNewLeads, notifyGeneratorsOfSales, markNoticesSeen } from '../lib/partner-leads.js';
import { logLeadActivity, convertLead, setLeadStage } from '../lib/leads.js';
import { partnerPortfolio } from '../lib/partner-portfolio.js';
import { partnerStatus, validPhone } from '../lib/partner-lead-rules.js';
import { POST as leadsPost, GET as leadsGet } from '../app/api/partner/leads/route.js';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'partner-leads-test-secret';
const OWNER = 'owner@x.ca';
const ORG = 'aljo@aljo.ca';
const ANNA = 'anna@aljo.ca', BEN = 'ben@aljo.ca';
const OTHER_ORG = 'rival@rival.ca', RIVAL_GEN = 'zed@rival.ca';
const REP = { email: 'roushi@bargainbay.ca', name: 'Roushi', admin: false };
const base = { want: 'appliance', howReached: 'message', note: 'Wants a washer in Ajax' };

async function setup() {
  await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15 }, OWNER);
  await addTeamMember(ORG, { email: ANNA, name: 'Anna', role: 'affiliate' }, OWNER);
  await addTeamMember(ORG, { email: BEN, name: 'Ben', role: 'affiliate' }, OWNER);
  return { anna: await getPartnerSeat(ANNA), ben: await getPartnerSeat(BEN), admin: await getPartnerSeat(ORG) };
}
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };
async function userId(email) { return (await query(`SELECT id FROM users WHERE lower(email) = $1`, [email])).rows[0]?.id; }
async function as(email, fn) {
  __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: await userId(email), email, name: email, token_version: 0 }) });
  try { return await fn(); } finally { __setTestCookies(null); }
}
let n = 0;
async function order(email, status) {
  n += 1;
  const { rows } = await query(`INSERT INTO orders (order_number, email, name, status, subtotal, discount, total, hst) VALUES ($1,$2,'C',$3,1000,0,1000,0) RETURNING id`, [`BB-L${n}`, email, status]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,$2,'Washer',1000,600,'unit')`, [rows[0].id, `L${n}`]);
}

suite('partner leads (phase 2)');

test('a lead is sent, tagged to the generator and organisation, warm and unclaimed; bad input is refused with a reason', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    const r = await submitLead(anna, { name: 'Maria Lopez', phone: '(416) 555-1234', ...base });
    assert(r.ok && r.id);
    const l = (await query(`SELECT * FROM leads WHERE id = $1`, [r.id])).rows[0];
    equal(l.partner_email, ORG); equal(l.partner_member_email, ANNA); equal(l.temperature, 'warm'); equal(l.owner_email, null);
    equal(l.phone_key, '+14165551234'); equal(l.source, 'referral'); equal(l.side, 'bb');
    assert((await query(`SELECT 1 FROM lead_activities WHERE lead_id = $1 AND by_email IS NULL`, [r.id])).rows[0], 'the generator\'s note is on the history, not counted as a rep touch');
    assert(await rejects(() => submitLead(anna, { name: 'X', phone: '416', ...base }), 'invalid'), 'a bad phone is refused');
    assert(await rejects(() => submitLead(anna, { name: 'No Contact', ...base })), 'a phone or email is needed');
    assert(await rejects(() => submitLead(anna, { name: 'Bad Mail', email: 'a@mailinator.com', ...base })), 'a throwaway email is refused');
    assert(await rejects(() => submitLead(anna, { name: 'No Want', phone: '4165559999', howReached: 'text' })), 'what they want is needed');
    assert(validPhone('+1 (905) 555-2211') && !validPhone('5555555555') && !validPhone('1234567890'));
  } finally { done(); }
});

test('FIRST IN WINS: the same person from another generator is refused, whichever way the phone is written, and the sender is told nothing about who', async () => {
  const { done } = await withTestDb();
  try {
    const { anna, ben, admin } = await setup();
    const first = await submitLead(anna, { name: 'Maria Lopez', phone: '416-555-1234', ...base });
    assert(first.ok);
    for (const phone of ['(416) 555 1234', '+1 416 555 1234', '14165551234']) {
      const r = await submitLead(ben, { name: 'Maria L', phone, ...base });
      equal(r.ok, false); equal(r.duplicate, 'other');
      assert(!/anna|aljo|customer|\d{3}/i.test(r.message), 'the message names nobody and shows nothing');
    }
    equal((await query(`SELECT COUNT(*)::int AS n FROM leads`)).rows[0].n, 1, 'still one lead');
    const mine = await myLeads(ben);
    equal(mine.leads.length, 0, 'it is not on the second generator\'s list');
    assert(mine.notices.some((x) => x.kind === 'duplicate'), 'but they have a saved notice');
    const ov = await orgOverview(admin);
    assert(ov.duplicates.some((d) => d.sender === 'Ben' && d.firstSentBy === 'Anna'), 'the organisation\'s admin sees who sent it first');
    equal(ov.generators.find((g) => g.email === BEN).dups, 3);
    // Email match works too.
    const e1 = await submitLead(anna, { name: 'Sam Roy', email: 'Sam.Roy@Example.com', ...base });
    assert(e1.ok);
    equal((await submitLead(ben, { name: 'Sam', email: 'sam.roy@example.com', ...base })).duplicate, 'other');
  } finally { done(); }
});

test('the same generator sending the same person again is told where it stands, not that it was refused as someone else\'s', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await submitLead(anna, { name: 'Maria', phone: '4165551234', ...base });
    const again = await submitLead(anna, { name: 'Maria', phone: '4165551234', ...base });
    equal(again.duplicate, 'own'); equal(again.lead.statusLabel, 'Sent');
    equal((await myLeads(anna)).notices.filter((x) => x.kind === 'duplicate').length, 0, 'no "someone else" notice for your own');
  } finally { done(); }
});

test('another organisation is refused the same way and learns nothing; an existing lead or customer of ours also blocks', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await savePartner({ email: OTHER_ORG, name: 'Rival', pct: 10 }, OWNER);
    await addTeamMember(OTHER_ORG, { email: RIVAL_GEN, name: 'Zed', role: 'affiliate' }, OWNER);
    const zed = await getPartnerSeat(RIVAL_GEN);
    await submitLead(anna, { name: 'Maria', phone: '4165551234', ...base });
    const r = await submitLead(zed, { name: 'Maria', phone: '4165551234', ...base });
    equal(r.duplicate, 'other');
    const ov = await orgOverview({ org: OTHER_ORG, role: 'admin' });
    assert(ov.duplicates.every((d) => d.firstSentBy == null), 'a rival\'s admin never learns who sent it first');
    // Existing customer, existing Sales Hub lead.
    await upsertCustomer({ email: 'carl@x.ca', name: 'Carl', phone: '9055550101' });
    equal((await submitLead(anna, { name: 'Carl', phone: '9055550101', ...base })).duplicate, 'other', 'a customer is not a new lead');
    await query(`INSERT INTO leads (contact_name, phone, phone_key, created_by) VALUES ('Dana', '2895550142', '+12895550142', 'john@x.ca')`);
    equal((await submitLead(anna, { name: 'Dana', phone: '2895550142', ...base })).duplicate, 'other', 'a lead John already has is not new');
  } finally { done(); }
});

test('a partner login cannot be sent as a lead (self-dealing)', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    assert(await rejects(() => submitLead(anna, { name: 'Ben', email: BEN, ...base }), 'self'));
    assert(await rejects(() => submitLead(anna, { name: 'Me', email: ORG, ...base }), 'self'));
  } finally { done(); }
});

test('ceilings: no more than 10 leads in ten minutes from one login', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    for (let i = 0; i < 10; i++) assert((await submitLead(anna, { name: `Person ${i}`, phone: `41655510${String(i).padStart(2, '0')}`, ...base })).ok);
    assert(await rejects(() => submitLead(anna, { name: 'One More', phone: '4165559876', ...base }), 'rate'));
  } finally { done(); }
});

test('isolation: a generator reads only their own leads, an admin reads the organisation\'s, and the sender sees no rep, note or money', async () => {
  const { done } = await withTestDb();
  try {
    const { anna, ben, admin } = await setup();
    await submitLead(anna, { name: 'A Lead', phone: '4165550001', ...base });
    await submitLead(ben, { name: 'B Lead', phone: '4165550002', ...base });
    const a = await myLeads(anna);
    equal(a.leads.length, 1); equal(a.leads[0].name, 'A Lead');
    assert(!('sender' in a.leads[0]), 'a generator is not shown who else sent');
    const keys = JSON.stringify(a);
    assert(!/owner|rep|note|price|cost|commission|profit/i.test(keys.replace(/howReached/, '')), 'nothing internal in what a generator receives');
    const all = await myLeads(admin);
    equal(all.leads.length, 2); assert(all.leads.every((l) => l.sender));
    assert(await rejects(() => orgOverview(anna), 'forbidden'), 'a generator cannot read the organisation overview');
  } finally { done(); }
});

test('the status is derived: sent -> with our team -> called -> in conversation -> sold -> completed; junk is not counted', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    const { id } = await submitLead(anna, { name: 'Maria Lopez', phone: '4165551234', email: 'maria@x.ca', ...base });
    const st = async () => (await myLeads(anna)).leads[0].status;
    equal(await st(), 'sent');
    await claimLead(id, REP);
    equal(await st(), 'with_team');
    await logLeadActivity(id, { kind: 'call', outcome: 'no_answer' }, REP);
    equal(await st(), 'called');
    await logLeadActivity(id, { kind: 'call', outcome: 'conversation', notes: 'internal only' }, REP);
    equal(await st(), 'talking');
    assert(!JSON.stringify(await myLeads(anna)).includes('internal only'), 'notes never reach the sender');
    const conv = await convertLead(id, REP);
    equal(conv.ownsIt, false, 'the rep is NOT made the owner of a partner\'s customer');
    const cust = (await query(`SELECT partner_email, partner_member_email, owner_email FROM customers WHERE id = $1`, [conv.customerId])).rows[0];
    equal(cust.partner_email, ORG); equal(cust.partner_member_email, ANNA); equal(cust.owner_email, null);
    equal(await st(), 'talking', 'converting alone is not a sale');
    await order('maria@x.ca', 'confirmed');
    equal(await st(), 'sold');
    await query(`UPDATE orders SET status = 'delivered' WHERE email = 'maria@x.ca'`);
    equal(await st(), 'completed');
    await query(`UPDATE orders SET status = 'cancelled' WHERE email = 'maria@x.ca'`);
    equal(await st(), 'talking', 'a cancelled order takes it back');
    // Junk.
    const j = await submitLead(anna, { name: 'Fake Person', phone: '4165557777', ...base });
    await claimLead(j.id, REP);
    await setLeadStage(j.id, 'lost', { lostReason: 'junk' }, REP);
    equal((await myLeads(anna)).leads.find((l) => l.id === j.id).status, 'not_counted');
    equal(partnerStatus({ stage: 'lost', lost_reason: 'no_response' }), 'couldnt_reach');
  } finally { done(); }
});

test('claiming: two reps pressing at once cannot both get it; the queue shows unclaimed then mine', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    const { id } = await submitLead(anna, { name: 'Maria', phone: '4165551234', ...base });
    let q = await partnerLeadQueue(REP);
    equal(q.unclaimed.length, 1); equal(q.unclaimed[0].sender, 'Anna'); equal(q.unclaimed[0].org, 'Aljo Systems');
    await claimLead(id, REP);
    assert(await rejects(() => claimLead(id, { email: 'john@bargainbay.ca', name: 'John' }), 'taken'));
    q = await partnerLeadQueue(REP);
    equal(q.unclaimed.length, 0); equal(q.mine.length, 1);
    equal((await partnerLeadQueue({ email: 'john@bargainbay.ca', admin: false })).mine.length, 0, 'John does not see Roushi\'s');
  } finally { done(); }
});

test('the team is emailed in batches: a second lead inside ten minutes does not send another', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await submitLead(anna, { name: 'One', phone: '4165550011', ...base });                // the send happens inside the submit
    assert((await query(`SELECT notified_at FROM leads`)).rows[0].notified_at, 'the first lead was announced');
    await submitLead(anna, { name: 'Two', phone: '4165550012', ...base });
    const two = (await query(`SELECT notified_at FROM leads WHERE contact_name = 'Two'`)).rows[0];
    equal(two.notified_at, null, 'the second waits: no second email inside ten minutes');
    await query(`UPDATE leads SET notified_at = now() - interval '11 minutes' WHERE contact_name = 'One'`);
    equal((await notifyTeamOfNewLeads()).sent, 1, 'then it is announced');
    await markNoticesSeen(anna);
  } finally { done(); }
});

test('the routes: a generator sends and reads; a non-partner is refused', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    await upsertCustomer({ email: 'nobody@x.ca', name: 'Nobody' });
    await query(`INSERT INTO users (email, name, password_hash) VALUES ('nobody@x.ca','N','x') ON CONFLICT (email) DO NOTHING`);
    const req = (body) => new NextRequest('http://localhost/api/partner/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = await as(ANNA, () => leadsPost(req({ action: 'submit', name: 'Route Test', phone: '4165550123', ...base })));
    equal(ok.status, 200);
    const dup = await as(BEN, () => leadsPost(req({ action: 'submit', name: 'Route Test', phone: '4165550123', ...base })));
    equal(dup.status, 409); equal((await dup.json()).duplicate, 'other');
    const mine = await as(ANNA, () => leadsGet(new NextRequest('http://localhost/api/partner/leads')));
    equal((await mine.json()).leads.length, 1);
    const no = await as('nobody@x.ca', () => leadsPost(req({ action: 'submit', name: 'X Y', phone: '4165550124', ...base })));
    equal(no.status, 403);
    __setTestCookies(null);
    equal((await leadsGet(new NextRequest('http://localhost/api/partner/leads'))).status, 401);
  } finally { done(); }
});

test('the owner\'s portfolio: one row per partner with leads, money, generators and flags', async () => {
  const { done } = await withTestDb();
  try {
    const { anna, ben } = await setup();
    await submitLead(anna, { name: 'Maria', phone: '4165551234', email: 'maria@x.ca', ...base });
    await submitLead(ben, { name: 'Maria', phone: '4165551234', ...base });                 // a duplicate
    const p = await partnerPortfolio();
    equal(p.orgs.length, 1);
    const o = p.orgs[0];
    equal(o.generators, 2); equal(o.leads.sent, 1); equal(o.leads.dups, 1);
    equal(o.generatorRows.find((g) => g.email === ANNA).sent, 1);
    assert(p.changes.some((c) => /lead generator/.test(c.summary || '')), 'who added whom is on the change log');
    equal(p.totals.leads, 1);
  } finally { done(); }
});

test('a generator is told ONCE when their lead has bought, and never about a lead that has not', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    const { id } = await submitLead(anna, { name: 'Maria Lopez', phone: '4165551234', email: 'maria@x.ca', ...base });
    await claimLead(id, REP);
    await convertLead(id, REP);
    equal((await notifyGeneratorsOfSales()).sent, 0, 'converted is not a sale');
    await order('maria@x.ca', 'confirmed');
    equal((await notifyGeneratorsOfSales()).sent, 1, 'a real order tells the sender');
    assert((await query(`SELECT sold_notified_at FROM leads WHERE id = $1`, [id])).rows[0].sold_notified_at, 'remembered');
    equal((await notifyGeneratorsOfSales()).sent, 0, 'and never again');
  } finally { done(); }
});
