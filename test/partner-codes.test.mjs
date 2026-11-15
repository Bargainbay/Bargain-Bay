// Phase 3: each lead generator's OWN code, and crediting a sale to the right person: by code, by lead, or by the safety net.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { upsertCustomer } from '../lib/customers.js';
import {
  savePartner, revokePartner, setPartnerCode, addTeamMember, removeTeamMember, getPartnerSeat, partnerByCouponCode, attachPartnerForOrder, partnerReport, ensureGeneratorCode
} from '../lib/referral-partners.js';
import { submitLead, myLeads, orgOverview, claimLead } from '../lib/partner-leads.js';
import { reconcilePartnerLeads } from '../lib/partner-attribution.js';
import { setLeadStage } from '../lib/leads.js';

const OWNER = 'owner@x.ca', ORG = 'aljo@aljo.ca', ANNA = 'anna@aljo.ca', BEN = 'ben@aljo.ca';
const REP = { email: 'roushi@bargainbay.ca', name: 'Roushi', admin: false };
const base = { want: 'appliance', howReached: 'message' };
let n = 0;
async function order(email, { price = 1000, cost = 600, status = 'confirmed', coupon = null } = {}) {
  n += 1;
  const { rows } = await query(`INSERT INTO orders (order_number, email, name, status, subtotal, discount, total, hst, coupon_code) VALUES ($1,$2,'C',$3,$4,0,$4,0,$5) RETURNING id`, [`BB-C${n}`, email, status, price, coupon]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,$2,'Washer',$3,$4,'unit')`, [rows[0].id, `C${n}`, price, cost]);
}
async function setup() {
  await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15, leadPct: 12 }, OWNER);   // reseller 15, customer discount 5, leads 12
  await addTeamMember(ORG, { email: ANNA, name: 'Anna Lopez', role: 'affiliate' }, OWNER);
  await addTeamMember(ORG, { email: BEN, name: 'Ben Ray', role: 'affiliate' }, OWNER);
  return { anna: await getPartnerSeat(ANNA), ben: await getPartnerSeat(BEN) };
}
const codeOf = async (e) => (await query(`SELECT code, coupon_id FROM partner_members WHERE member_email = $1`, [e])).rows[0];

suite('generator codes and credit (phase 3)');

test('adding a generator makes their own code and coupon; the code is stable; removing them switches it off', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const a = await codeOf(ANNA);
    equal(a.code, 'ALJO-ANNA');
    const coupon = (await query(`SELECT code, value::float8 AS value, active FROM coupons WHERE id = $1`, [a.coupon_id])).rows[0];
    equal(coupon.value, 5); equal(coupon.active, true);
    // A second Anna gets a different code, never the same one.
    await addTeamMember(ORG, { email: 'anna2@aljo.ca', name: 'Anna Smith', role: 'affiliate' }, OWNER);
    equal((await codeOf('anna2@aljo.ca')).code, 'ALJO-ANNAB');
    // Changing the customer discount edits the coupon in place and keeps the code.
    await savePartner({ email: ORG, pct: 15, customerPct: 8 }, OWNER);
    equal((await codeOf(ANNA)).code, 'ALJO-ANNA');
    equal((await query(`SELECT value::float8 AS v FROM coupons WHERE id = $1`, [a.coupon_id])).rows[0].v, 8);
    await removeTeamMember(ORG, ANNA, OWNER);
    equal((await query(`SELECT active FROM coupons WHERE id = $1`, [a.coupon_id])).rows[0].active, false, 'a removed generator\'s code stops working');
    equal(await partnerByCouponCode('ALJO-ANNA'), null, 'and no longer attributes anything');
  } finally { done(); }
});

test('a generator code resolves to the organisation AND the generator', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const p = await partnerByCouponCode('aljo-anna');
    equal(p.email, ORG); equal(p.member_email, ANNA);
    equal((await partnerByCouponCode('ALJO5')).member_email, null, 'the organisation\'s own end-user code has no generator');
  } finally { done(); }
});

test('an order with a generator code credits the generator, at the code rate (15 less the 5% discount)', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const r = await attachPartnerForOrder({ couponCode: 'ALJO-ANNA', email: 'maria@x.ca', name: 'Maria' });
    assert(r.attached);
    const c = (await query(`SELECT partner_email, partner_member_email, partner_set_by FROM customers WHERE email = 'maria@x.ca'`)).rows[0];
    equal(c.partner_email, ORG); equal(c.partner_member_email, ANNA); equal(c.partner_set_by, 'order link');
    await order('maria@x.ca', { price: 1000, cost: 600, coupon: 'ALJO-ANNA' });          // profit 400
    const rep = await partnerReport(ORG);
    equal(rep.clients[0].generator, 'Anna Lopez');
    equal(rep.clients[0].orders[0].source, 'code');
    equal(rep.clients[0].orders[0].commission, 40, '10% of $400');
    assert(!JSON.stringify(await myLeads(await getPartnerSeat(ANNA))).includes('commission'), 'the generator sees no money');
    const mine = (await myLeads(await getPartnerSeat(ANNA))).mine;
    equal(mine.code, 'ALJO-ANNA'); equal(mine.orders, 1);
    const ov = await orgOverview(await getPartnerSeat(ORG));
    equal(ov.generators.find((g) => g.email === ANNA).orders, 1);
  } finally { done(); }
});

test('FIRST IN WINS at checkout: a lead sent by Anna stays Anna\'s even if Ben\'s code is typed; commission is the lead rate', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await submitLead(anna, { name: 'Maria Lopez', phone: '4165551234', email: 'maria@x.ca', ...base });
    const r = await attachPartnerForOrder({ couponCode: 'ALJO-BEN', email: 'maria@x.ca', name: 'Maria' });
    assert(r.attached && r.found);
    const c = (await query(`SELECT partner_member_email, partner_set_by FROM customers WHERE email = 'maria@x.ca'`)).rows[0];
    equal(c.partner_member_email, ANNA); equal(c.partner_set_by, 'lead');
    assert((await query(`SELECT customer_id FROM leads`)).rows[0].customer_id, 'the lead is linked to the customer');
    await order('maria@x.ca', { price: 1000, cost: 600 });                               // no code on the order: pure lead sale
    const o = (await partnerReport(ORG)).clients[0].orders[0];
    equal(o.source, 'lead'); equal(o.commission, 48, '12% of $400');
    equal((await myLeads(anna)).leads[0].status, 'sold');
  } finally { done(); }
});

test('a lead outside the 90-day window, or marked junk, earns nobody anything', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    const old = await submitLead(anna, { name: 'Old Lead', phone: '4165550001', email: 'old@x.ca', ...base });
    await query(`UPDATE leads SET submitted_at = now() - interval '100 days' WHERE id = $1`, [old.id]);
    equal((await attachPartnerForOrder({ email: 'old@x.ca', name: 'Old' })).attached, false);
    const junk = await submitLead(anna, { name: 'Junk Lead', phone: '4165550002', email: 'junk@x.ca', ...base });
    await claimLead(junk.id, REP); await setLeadStage(junk.id, 'lost', { lostReason: 'junk' }, REP);
    equal((await attachPartnerForOrder({ email: 'junk@x.ca', name: 'Junk' })).attached, false);
  } finally { done(); }
});

test('a generator buying with their own code, or the team buying for themselves, earns nobody anything', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const r = await attachPartnerForOrder({ couponCode: 'ALJO-ANNA', email: ANNA, name: 'Anna' });
    equal(r.attached, false); assert(r.own);
    // Even if such a customer ends up under the partner some other way, the commission is $0.
    const id = await upsertCustomer({ email: BEN, name: 'Ben' });
    await query(`UPDATE customers SET partner_email = $2, partner_set_by = 'order link' WHERE id = $1`, [id, ORG]);
    await order(BEN, { price: 1000, cost: 600 });
    const o = (await partnerReport(ORG)).clients.find((c) => c.email === BEN).orders[0];
    equal(o.commission, 0); assert(o.own);
  } finally { done(); }
});

test('the safety net: a lead whose person bought without the rep pressing Convert is linked and credited', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await submitLead(anna, { name: 'Maria Lopez', phone: '4165551234', email: 'maria@x.ca', ...base });
    await upsertCustomer({ email: 'maria@x.ca', name: 'Maria' });                       // she bought some other way: no attach call
    await order('maria@x.ca', { price: 1000, cost: 600 });
    equal((await reconcilePartnerLeads()).linked, 1);
    const c = (await query(`SELECT partner_email, partner_member_email, partner_set_by FROM customers WHERE email = 'maria@x.ca'`)).rows[0];
    equal(c.partner_member_email, ANNA); equal(c.partner_set_by, 'lead');
    equal((await myLeads(anna)).leads[0].status, 'sold');
    equal((await reconcilePartnerLeads()).linked, 0, 'running it again changes nothing');
  } finally { done(); }
});

test('a customer already under another partner is never moved, by a lead or a code', async () => {
  const { done } = await withTestDb();
  try {
    const { anna } = await setup();
    await savePartner({ email: 'rival@rival.ca', name: 'Rival', pct: 10 }, OWNER);
    const id = await upsertCustomer({ email: 'carl@x.ca', name: 'Carl' });
    await query(`UPDATE customers SET partner_email = 'rival@rival.ca', partner_set_by = 'sign-up link' WHERE id = $1`, [id]);
    await submitLead(anna, { name: 'Carl', phone: '9055550177', email: 'carl2@x.ca', ...base });   // a different identifier, so it was accepted
    equal((await attachPartnerForOrder({ couponCode: 'ALJO-ANNA', email: 'carl@x.ca', name: 'Carl' })).attached, false);
    equal((await query(`SELECT partner_email FROM customers WHERE id = $1`, [id])).rows[0].partner_email, 'rival@rival.ca');
  } finally { done(); }
});

test('with no customer discount there is no generator coupon, and switching it back on makes one', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo', pct: 15, customerPct: 0 }, OWNER);
    await addTeamMember(ORG, { email: ANNA, name: 'Anna', role: 'affiliate' }, OWNER);
    equal((await codeOf(ANNA)).code, null);
    await savePartner({ email: ORG, pct: 15, customerPct: 5 }, OWNER);
    equal((await codeOf(ANNA)).code, 'ALJO-ANNA');
    equal(await ensureGeneratorCode('nobody@x.ca'), null);
  } finally { done(); }
});

test('revoking a partner switches off the end-user code and every generator code, and frees the link code for reuse', async () => {
  const { done } = await withTestDb();
  try {
    await setup();
    const a = await codeOf(ANNA);
    await revokePartner(ORG, OWNER);
    const active = (await query(`SELECT code, active FROM coupons WHERE code IN ('ALJO5', 'ALJO-ANNA', 'ALJO-BEN') ORDER BY code`)).rows;
    equal(active.length, 3);
    assert(active.every((c) => c.active === false), 'no shopper can still get a discount from a revoked partner');
    equal(await partnerByCouponCode('ALJO-ANNA'), null);
    assert(a.coupon_id, 'the generator coupon existed');
    // A new organisation can now have the link code the revoked one held.
    const NEW = 'real@aljo.ca';
    await savePartner({ email: NEW, name: 'Aljo Real', pct: 15 }, OWNER);
    const got = await setPartnerCode(NEW, 'aljo', OWNER);
    equal(got.code, 'aljo');
  } finally { done(); }
});
