// Lead generators inside a partner organisation (Aljo Systems), phase 1: the role and the wall around it.
//
// The one property that matters: a generator (role 'affiliate') must be refused by EVERY existing partner surface, because
// those surfaces show the organisation's clients, orders, profit and commission. They all ask getPartner(), which is
// admin-only on purpose, so this file calls the real routes as a generator and requires a refusal.
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';
import { upsertCustomer } from '../lib/customers.js';
import {
  savePartner, addTeamMember, removeTeamMember, listTeam, getPartner, getPartnerSeat, partnerReport, requestForClient, setClientPartner, listPartners
} from '../lib/referral-partners.js';
import { POST as teamPost } from '../app/api/partner/team/route.js';
import { POST as requestPost } from '../app/api/partner/request/route.js';
import { GET as statementGet } from '../app/api/partner/statement/route.js';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'generator-test-secret';

const ORG = 'aljo@aljo.ca';
const OWNER = 'owner@x.ca';
const GEN = 'anna@aljo.ca';
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };

async function userId(email) { return (await query(`SELECT id FROM users WHERE lower(email) = $1`, [email])).rows[0]?.id; }
async function as(email, fn) {
  __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: await userId(email), email, name: email, token_version: 0 }) });
  try { return await fn(); } finally { __setTestCookies(null); }
}
const req = (url, body) => new NextRequest(`http://localhost${url}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);

suite('partner lead generators (phase 1)');

test('generators are ON by default: an organisation adds its own with no owner step; the owner has a kill switch', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15 }, OWNER);
    const added = await addTeamMember(ORG, { email: GEN, name: 'Anna', role: 'affiliate' }, OWNER);
    assert(added.ok && added.accountCreated, 'the generator gets a login with no switch to flip');
    assert(await rejects(() => addTeamMember(ORG, { email: 'x@x.ca', role: 'owner' }, OWNER), 'role'), 'only admin or affiliate');
    await savePartner({ email: ORG, pct: 15, generators: false }, OWNER);
    assert(await rejects(() => addTeamMember(ORG, { email: 'y@x.ca', role: 'affiliate' }, OWNER), 'nogenerators'), 'kill switch');
  } finally { done(); }
});

test('guard rails: a ceiling on generators and on how fast they are added', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo', pct: 15 }, OWNER);
    for (let i = 0; i < 30; i++) await addTeamMember(ORG, { email: `g${i}@aljo.ca`, name: `G${i}`, role: 'affiliate' }, OWNER);
    assert(await rejects(() => addTeamMember(ORG, { email: 'g31@aljo.ca', role: 'affiliate' }, OWNER), 'rate'), '30 an hour');
    await query(`UPDATE partner_members SET added_at = now() - interval '2 hours'`);
    for (let i = 30; i < 100; i++) await query(`INSERT INTO partner_members (member_email, partner_email, role, added_at) VALUES ($1,$2,'affiliate', now() - interval '2 hours')`, [`g${i}@aljo.ca`, ORG]);
    assert(await rejects(() => addTeamMember(ORG, { email: 'extra@aljo.ca', role: 'affiliate' }, OWNER), 'toomany'), 'ceiling');
  } finally { done(); }
});

test('a generator is NOT a partner: every existing partner read refuses them', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15 }, OWNER);
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    await setClientPartner(c, ORG, 'client', OWNER);
    await addTeamMember(ORG, { email: GEN, name: 'Anna', role: 'affiliate' }, OWNER);
    equal(await getPartner(GEN), null, 'getPartner is admin-only');
    const rep = await partnerReport(GEN);
    equal(rep.partner, null); equal(rep.clients.length, 0); equal(rep.totals.orders, 0);
    assert(await rejects(() => requestForClient(GEN, c, 'quote please'), 'nopartner'), 'cannot raise requests for the org\'s clients');
    const seat = await getPartnerSeat(GEN);
    equal(seat.role, 'affiliate'); equal(seat.org, ORG);
  } finally { done(); }
});

test('the routes turn a generator away: team, request, statement', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15 }, OWNER);
    const c = await upsertCustomer({ email: 'roger@x.ca', name: 'Roger' });
    await setClientPartner(c, ORG, 'client', OWNER);
    await addTeamMember(ORG, { email: GEN, name: 'Anna', role: 'affiliate' }, OWNER);
    await query(`INSERT INTO users (email, name, password_hash) VALUES ($1,'Org','x') ON CONFLICT (email) DO NOTHING`, [ORG]);

    const addFriend = await as(GEN, () => teamPost(req('/api/partner/team', { action: 'add', email: 'friend@x.ca', name: 'Friend', role: 'affiliate' })));
    equal(addFriend.status, 403, 'a generator cannot add anybody');
    equal((await listTeam(ORG)).length, 2, 'and nobody was added');
    const ask = await as(GEN, () => requestPost(req('/api/partner/request', { customerId: c, note: 'a quote for Roger please' })));
    assert(ask.status === 403, `request must be refused, got ${ask.status}`);
    const stmt = await as(GEN, () => statementGet(req('/api/partner/statement')));
    equal(stmt.status, 403, 'no statement, so no commission figures');

    // The same routes still work for the organisation's own admin.
    const ok = await as(ORG, () => teamPost(req('/api/partner/team', { action: 'add', email: 'amy@aljo.ca', name: 'Amy', role: 'admin' })));
    equal(ok.status, 200);
    const amy = await getPartner('amy@aljo.ca');
    equal(amy.email, ORG, 'an admin teammate still resolves to the organisation');
  } finally { done(); }
});

test('SecondShop is unchanged: existing teammates default to admin and see the organisation', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: 'jdriver13@live.ca', name: 'SecondShop', pct: 20 }, OWNER);
    await addTeamMember('jdriver13@live.ca', { email: 'amy@secondshop.ca', name: 'Amy' }, OWNER);
    const t = await listTeam('jdriver13@live.ca');
    equal(t.find((m) => m.email === 'amy@secondshop.ca').role, 'admin');
    assert(await getPartner('amy@secondshop.ca'), 'a plain teammate is still a partner');
    const p = (await listPartners())[0];
    equal(p.generators, true, 'on for every organisation');
  } finally { done(); }
});

test('removing a generator locks them out at once; they cannot be a partner or on two teams', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo', pct: 15 }, OWNER);
    await savePartner({ email: 'other@x.ca', name: 'Other', pct: 10 }, OWNER);
    await addTeamMember(ORG, { email: GEN, name: 'Anna', role: 'affiliate' }, OWNER);
    assert(await rejects(() => addTeamMember('other@x.ca', { email: GEN, role: 'affiliate' }, OWNER), 'teammate'), 'one team per person');
    assert(await rejects(() => savePartner({ email: GEN, pct: 10 }, OWNER), 'teammate'), 'a generator cannot also be a partner');
    assert(await getPartnerSeat(GEN), 'active');
    await removeTeamMember(ORG, GEN, OWNER);
    equal(await getPartnerSeat(GEN), null, 'a removed generator has no seat');
  } finally { done(); }
});

test('the lead rate and the generators switch are saved per partner, and a blank leaves them alone', async () => {
  const { done } = await withTestDb();
  try {
    await savePartner({ email: ORG, name: 'Aljo', pct: 15, leadPct: 10, generators: false }, OWNER);
    let p = (await listPartners()).find((x) => x.email === ORG);
    equal(p.lead_pct, 10); equal(p.generators, false);
    await savePartner({ email: ORG, pct: 15, leadPct: 12 }, OWNER);              // generators left blank: unchanged
    p = (await listPartners()).find((x) => x.email === ORG);
    equal(p.lead_pct, 12); equal(p.generators, false);
    assert(await rejects(() => savePartner({ email: ORG, pct: 15, leadPct: 80 }, OWNER), 'pct'), 'out of range');
  } finally { done(); }
});
