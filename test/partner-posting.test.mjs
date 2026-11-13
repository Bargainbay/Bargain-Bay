// Phase 5: the posting kit and the nightly take-down list. Email is captured by stubbing fetch (Resend); the stock is real rows.
import { NextRequest } from 'next/server';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth.js';
import { savePartner, addTeamMember, getPartnerSeat } from '../lib/referral-partners.js';
import { readStock, postingView, setPosted, runPostingDigest, recordStockSnapshot, newSinceLastNight, postingCounts, goneSkus } from '../lib/partner-posting.js';
import { orgOverview } from '../lib/partner-leads.js';
import { fbCaption } from '../lib/fb-kit.js';
import { GET as postingGet, POST as postingPost } from '../app/api/partner/posting/route.js';
import { GET as zipGet } from '../app/api/partner/posting/zip/route.js';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'posting-test-secret';

const OWNER = 'owner@x.ca', ORG = 'aljo@aljo.ca', ANNA = 'anna@aljo.ca', BEN = 'ben@aljo.ca';
const realFetch = globalThis.fetch;
let sentTo = [];
const mail = (ok = true) => { sentTo = []; globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); if (ok) sentTo.push({ to: b.to[0], subject: b.subject, html: b.html }); return { ok, status: ok ? 200 : 500, text: async () => '{"id":"1"}' }; }; };
// Email is switched on ONLY inside a test, with fetch stubbed from the first line, and put back after: a leaked ALLOW_REAL_OUTBOUND would
// let a later test file send real mail. The account invites made by setup() are captured by the same stub.
const saved = {};
const arm = (ok = true) => { saved.key = process.env.RESEND_API_KEY; saved.allow = process.env.ALLOW_REAL_OUTBOUND; process.env.RESEND_API_KEY = 'test-key'; process.env.ALLOW_REAL_OUTBOUND = 'yes-i-mean-it'; mail(ok); };
const restore = () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [['RESEND_API_KEY', saved.key], ['ALLOW_REAL_OUTBOUND', saved.allow]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};

async function stock(skus = ['A1', 'B2', 'C3']) {
  for (const sku of skus) {
    await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, compare_at, active) VALUES ($1,'LG',$2,'Washer',$3,'Refurbished',500,300,900,true) ON CONFLICT (sku) DO NOTHING`, [sku, `M-${sku}`, `LG Washer ${sku}`]);
  }
}
async function sell(sku, status = 'confirmed') {
  const { rows } = await query(`INSERT INTO orders (order_number, email, name, status, subtotal, total, hst) VALUES ($1,'c@x.ca','C',$2,500,500,0) RETURNING id`, [`BB-P${sku}${Math.random()}`.slice(0, 20), status]);
  await query(`INSERT INTO order_items (order_id, sku, title, price, cost, kind) VALUES ($1,$2,'x',500,300,'unit')`, [rows[0].id, sku]);
  return rows[0].id;
}
async function setup() {
  await savePartner({ email: ORG, name: 'Aljo Systems', pct: 15 }, OWNER);
  await addTeamMember(ORG, { email: ANNA, name: 'Anna Lopez', role: 'affiliate' }, OWNER);
  await addTeamMember(ORG, { email: BEN, name: 'Ben Ray', role: 'affiliate' }, OWNER);
  return { anna: await getPartnerSeat(ANNA), ben: await getPartnerSeat(BEN), admin: await getPartnerSeat(ORG) };
}
async function userId(email) { return (await query(`SELECT id FROM users WHERE lower(email) = $1`, [email])).rows[0]?.id; }
async function as(email, fn) {
  __setTestCookies({ [SESSION_COOKIE]: await createSessionToken({ id: await userId(email), email, name: email, token_version: 0 }) });
  try { return await fn(); } finally { __setTestCookies(null); }
}
const rejects = async (fn, code) => { try { await fn(); } catch (e) { return !code || e.code === code; } return false; };
const day = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

suite('partner posting kit and take-down (phase 5)');

test('GONE means sold or held for a customer; a 30-minute card checkout hold does NOT take it off the kit', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    await stock(['A1', 'B2', 'C3', 'D4']);
    await sell('B2');                                                                           // sold
    await query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('C3', 1, now() + interval '5 days')`);      // an e-transfer / invoice hold
    await query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('D4', 2, now() + interval '20 minutes')`);  // someone is in checkout
    const gone = await goneSkus();
    assert(gone.has('B2') && gone.has('C3') && !gone.has('D4') && !gone.has('A1'));
    const s = await readStock();
    assert(s.ok); equal([...s.skus].sort(), ['A1', 'D4']);
  } finally { restore(); done(); }
});

test('an untrusted stock read is refused, so nobody is told their listings sold when we merely failed to look', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    equal((await readStock()).ok, false, 'empty');
    await stock(['A1', 'B2', 'C3', 'D4']);
    await query(`INSERT INTO stock_daily (day, skus, n) VALUES ($1, $2, 20)`, [day(-1), Array.from({ length: 20 }, (_, i) => `S${i}`)]);
    const r = await readStock();
    equal(r.ok, false); assert(/below/.test(r.reason), '4 units against a night before of 20 is not believable');
  } finally { restore(); done(); }
});

test('the kit: public prices only, the generator\'s own link and code in the words, nobody else\'s posts', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna, ben } = await setup();
    await stock();
    const v = await postingView(anna);
    assert(v.stockOk); equal(v.listings.length, 3);
    const l = v.listings.find((x) => x.sku === 'A1');
    equal(l.price, 500);
    assert(/Use code ALJO-ANNA at checkout for 5% off/.test(l.caption), 'their own code');
    assert(/\/product\/A1\?ref=ALJO-ANNA/.test(l.caption), 'their own link');
    const text = JSON.stringify(v);
    assert(!/"cost"|member|clearance/i.test(text), 'no cost, member price or clearance floor reaches a generator');
    await setPosted(anna, 'A1', 'posted');
    assert((await postingView(anna)).posted.A1);
    equal(Object.keys((await postingView(ben)).posted).length, 0, 'a colleague\'s posts are theirs alone');
    assert(!/ref=/.test(fbCaption({ id: 'X', make: 'LG', model: 'M', category: 'Washer', condition: 'Refurbished', price: 500 })), 'the staff caption is unchanged');
  } finally { restore(); done(); }
});

test('"I posted this" is refused for a unit that is not for sale, and when stock cannot be read', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna } = await setup();
    await stock();
    await sell('B2');
    assert(await rejects(() => setPosted(anna, 'B2', 'posted'), 'gone'));
    assert(await rejects(() => setPosted(anna, 'NOPE', 'posted'), 'gone'));
    assert(await rejects(() => setPosted(anna, '', 'posted')));
    assert(await rejects(() => setPosted(anna, 'A1', 'bogus')));
    equal((await setPosted(anna, 'A1', 'posted')).ok, true);
    await query(`DELETE FROM products`);
    assert(await rejects(() => setPosted(anna, 'A1', 'posted'), 'stock'), 'an unreadable stock never lets anything be marked');
  } finally { restore(); done(); }
});

test('the take-down list is the generator\'s own posted units that sold; a checkout hold does not appear; relisting clears it; taking it down removes it', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna, ben } = await setup();
    await stock(['A1', 'B2', 'C3', 'D4']);
    for (const s of ['A1', 'B2', 'C3']) await setPosted(anna, s, 'posted');
    await setPosted(ben, 'D4', 'posted');
    const orderId = await sell('B2');
    await query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('A1', 9, now() + interval '20 minutes')`);   // checkout hold: NOT gone
    let v = await postingView(anna);
    equal(v.takeDown.map((t) => t.sku), ['B2']);
    equal(v.takeDown[0].title, 'LG Washer B2', 'named, not just a code');
    equal((await postingView(ben)).takeDown.length, 0, 'Ben did not post B2');
    await query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [orderId]);        // the sale fell through: it is back
    v = await postingView(anna);
    equal(v.takeDown.length, 0, 'back on sale, so nothing to take down');
    await query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [orderId]);
    await postingView(anna);
    equal((await setPosted(anna, 'B2', 'taken_down')).ok, true);
    equal((await postingView(anna)).takeDown.length, 0);
    assert(await rejects(() => setPosted(ben, 'B2', 'taken_down'), 'notfound'), 'never somebody else\'s');
  } finally { restore(); done(); }
});

test('NEW is a comparison with last night\'s snapshot; with none, nothing is flagged', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    await stock(['A1', 'B2', 'C3']);
    equal(await newSinceLastNight(new Set(['A1', 'B2', 'C3'])), [], 'the first night is a baseline');
    await query(`INSERT INTO stock_daily (day, skus, n) VALUES ($1, $2, 1)`, [day(-1), ['A1']]);
    equal((await newSinceLastNight(new Set(['A1', 'B2', 'C3']))).sort(), ['B2', 'C3']);
    await recordStockSnapshot(new Set(['A1', 'B2']));
    equal((await query(`SELECT n FROM stock_daily WHERE day = $1`, [day(0)])).rows[0].n, 2);
  } finally { restore(); done(); }
});

test('the nightly email: take-downs and new items to each generator, a roll-up to the admins, never twice, retried when a send fails', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna } = await setup();
    await stock(['A1', 'B2', 'C3']);
    await query(`INSERT INTO stock_daily (day, skus, n) VALUES ($1, $2, 3)`, [day(-1), ['A1']]);          // B2 and C3 are new tonight
    await setPosted(anna, 'A1', 'posted');
    await sell('A1');
    mail(true);
    const r1 = await runPostingDigest();
    assert(r1.ok && r1.sent === 3, `Anna, Ben and the Aljo admin: ${JSON.stringify(r1)}`);
    const toAnna = sentTo.find((m) => m.to === ANNA);
    assert(/Take 1 listing down/.test(toAnna.subject) && /LG Washer A1/.test(toAnna.html) && /2 new items/.test(toAnna.html));
    assert(/new item/.test(sentTo.find((m) => m.to === BEN).subject), 'Ben has nothing to take down, only new items');
    assert(sentTo.find((m) => m.to === ORG).subject.startsWith('Team:'), 'the organisation gets a roll-up');
    assert(!/anna@|ben@/.test(sentTo.find((m) => m.to === BEN).html), 'one person\'s email never carries another\'s');
    equal((await query(`SELECT n FROM stock_daily WHERE day = $1`, [day(0)])).rows[0].n, 2, 'tonight\'s snapshot is recorded');
    const r2 = await runPostingDigest();
    equal(r2.sent, 0); equal(r2.already, 3);                                                              // a second run changes nothing
    // A failed send is given back and retried.
    await query(`DELETE FROM partner_digests`);
    mail(false);
    const bad = await runPostingDigest();
    equal(bad.sent, 0); equal(bad.failed, 3);
    equal((await query(`SELECT COUNT(*)::int AS n FROM partner_digests`)).rows[0].n, 0, 'nothing was left claimed');
    mail(true);
    equal((await runPostingDigest()).sent, 3, 'the retry sends them');
  } finally { restore(); done(); }
});

test('with stock that cannot be trusted, nothing is emailed and nobody is told a false take-down; a dry run sends and records nothing', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna } = await setup();
    await stock();
    await setPosted(anna, 'A1', 'posted');
    mail(true);
    const dry = await runPostingDigest({ dryRun: true });
    assert(dry.ok && dry.dryRun); equal(sentTo.length, 0);
    equal((await query(`SELECT COUNT(*)::int AS n FROM stock_daily`)).rows[0].n, 0);
    await query(`DELETE FROM products`);
    const r = await runPostingDigest();
    equal(r.ok, false); equal(r.sent, 0); equal(sentTo.length, 0);
    assert(/not trusted/.test(r.reason));
  } finally { restore(); done(); }
});

test('without a mail key nothing is lost: the claim is given back so a later run still sends', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    await setup();
    await stock(['A1', 'B2']);
    await query(`INSERT INTO stock_daily (day, skus, n) VALUES ($1, $2, 1)`, [day(-1), ['A1']]);
    const k = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
    const r = await runPostingDigest();
    assert(r.skipped >= 1 && r.sent === 0);
    equal((await query(`SELECT COUNT(*)::int AS n FROM partner_digests`)).rows[0].n, 0);
    process.env.RESEND_API_KEY = k;
  } finally { restore(); done(); }
});

test('the organisation sees who still has sold listings up, and late ones; routes refuse a non-partner', async () => {
  const { done } = await withTestDb();
  arm();
  try {
    const { anna, admin } = await setup();
    await stock();
    await setPosted(anna, 'A1', 'posted'); await setPosted(anna, 'B2', 'posted');
    await sell('B2');
    await postingView(anna);
    await query(`UPDATE affiliate_posts SET gone_at = now() - interval '2 days' WHERE sku = 'B2'`);
    const c = (await postingCounts(ORG)).get(ANNA);
    equal(c.up, 1); equal(c.toTakeDown, 1); equal(c.late, 1);
    const ov = await orgOverview(admin);
    equal(ov.generators.find((g) => g.email === ANNA).posting.late, 1);

    await query(`INSERT INTO users (email, name, password_hash) VALUES ('nobody@x.ca','N','x') ON CONFLICT (email) DO NOTHING`);
    const ok = await as(ANNA, () => postingGet());
    equal(ok.status, 200); assert((await ok.json()).listings.length >= 1);
    equal((await as('nobody@x.ca', () => postingGet())).status, 403);
    const req = new NextRequest('http://localhost/api/partner/posting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: 'C3', action: 'posted' }) });
    equal((await as(ANNA, () => postingPost(req))).status, 200);
    equal((await as(ANNA, () => zipGet(new NextRequest('http://localhost/api/partner/posting/zip?sku=B2')))).status, 404, 'a sold unit has no photo download');
    __setTestCookies(null);
    equal((await postingGet()).status, 401);
  } finally { restore(); done(); }
});
