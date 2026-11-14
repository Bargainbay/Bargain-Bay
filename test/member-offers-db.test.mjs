// Offers against a real Postgres (PGlite): the public path end to end. Email is captured by stubbing fetch (Resend).
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { __setTestCookies } from './stubs/next-headers.mjs';
import { unavailableSkus } from '../lib/reservations.js';
import { decorateOne } from '../lib/pricing.js';
import { getById } from '../lib/inventory.js';
import {
  submitPublicOffer, confirmOffer, decideOffer, offerToken, offerScope, acceptedOfferMap, ownOfferSkus,
  consumeOffers, openToOffers, setOfferMode, offerByLink, withdrawOffer
} from '../lib/member-offers.js';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'offers-test-secret';
const realFetch = globalThis.fetch;
const sent = [];
const saved = {};
function arm() {
  saved.key = process.env.RESEND_API_KEY; saved.allow = process.env.ALLOW_REAL_OUTBOUND;
  process.env.RESEND_API_KEY = 'test-key'; process.env.ALLOW_REAL_OUTBOUND = 'yes-i-mean-it';
  globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sent.push({ to: b.to[0], subject: b.subject }); return { ok: true, status: 200, text: async () => '{"id":"1"}' }; };
}
function restore() {
  globalThis.fetch = realFetch;
  for (const [k, e] of [['key', 'RESEND_API_KEY'], ['allow', 'ALLOW_REAL_OUTBOUND']]) { if (saved[k] === undefined) delete process.env[e]; else process.env[e] = saved[k]; }
}
const ADMIN = { email: 'owner@x.ca', name: 'Owner' };
const guest = (o = {}) => ({ sku: 'CHEAP-1', amount: 520, name: 'Pat Buyer', email: 'pat@example.com', phone: '416-555-0100', ip: '1.2.3.4', ...o });
async function rejects(fn, code) {
  try { await fn(); } catch (e) { equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return; }
  throw new Error(`expected a ${code} refusal`);
}

suite('offers (real database)');
test('the public path: gate, floor, confirm, accept, hold, price, checkout', async () => {
  const t = await withTestDb();
  arm();
  try {
    await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, compare_at, active) VALUES
      ('CHEAP-1','LG','M1','Washer','LG Washer','Refurbished',800,400,1400,true),
      ('PRICEY-1','LG','M2','Washer','LG Pricey','Refurbished',500,480,900,true),
      ('NOCOST-1','LG','M3','Washer','LG No Cost','Refurbished',800,NULL,1400,true)`);

    // which units are open
    const raw = await Promise.all(['CHEAP-1', 'PRICEY-1', 'NOCOST-1'].map((s) => getById(s)));
    const dec = await Promise.all(raw.map((r) => decorateOne({ ...r }, null)));
    const open = await openToOffers(dec);
    assert(open.has('CHEAP-1'), 'cheap-for-us unit is open');
    assert(!open.has('PRICEY-1'), 'no room: closed');
    assert(!open.has('NOCOST-1'), 'no cost on record: closed');

    // refusals
    await rejects(() => submitPublicOffer(guest({ sku: 'PRICEY-1', amount: 450 })), 'notopen');
    await rejects(() => submitPublicOffer(guest({ amount: 450 })), 'price');      // under cost + 25% = 500
    await rejects(() => submitPublicOffer(guest({ amount: 800 })), 'price');      // not below the price
    await rejects(() => submitPublicOffer(guest({ phone: '' })), 'invalid');
    await rejects(() => submitPublicOffer(guest({ email: 'nope' })), 'invalid');

    // a valid offer waits for the email to be confirmed
    const { id } = await submitPublicOffer(guest());
    assert(sent.some((m) => m.to === 'pat@example.com' && /Confirm/.test(m.subject)), 'confirmation email sent');
    await rejects(() => submitPublicOffer(guest()), 'duplicate');
    await rejects(() => decideOffer(id, 'accept', {}, ADMIN), 'unverified');
    await rejects(() => confirmOffer(id, 'bad-token'), 'forbidden');
    await confirmOffer(id, offerToken(id));

    // accept: held, priced for the holder only
    equal((await decideOffer(id, 'accept', {}, ADMIN)).status, 'accepted');
    assert((await unavailableSkus(['CHEAP-1'])).has('CHEAP-1'), 'unit is held');
    __setTestCookies({});
    equal((await acceptedOfferMap(await offerScope(null))).size, 0, 'a stranger gets no price');
    equal((await decorateOne({ ...(await getById('CHEAP-1')) }, null)).price, 800, 'stranger still pays the listed price');
    __setTestCookies({ bb_offers: `${id}.${offerToken(id)}` });
    const scope = await offerScope(null);
    assert((await ownOfferSkus(scope)).has('CHEAP-1'), 'holder may buy the held unit');
    equal((await decorateOne({ ...(await getById('CHEAP-1')) }, null)).price, 520, 'holder pays the agreed price');
    __setTestCookies({ bb_offers: `${id}.forged` });
    equal(await offerScope(null), null, 'a forged cookie is ignored');

    // checkout uses it up and frees the offer hold for the order's own reservation
    __setTestCookies({ bb_offers: `${id}.${offerToken(id)}` });
    await consumeOffers(t.client, await offerScope(null), ['CHEAP-1'], 99);
    equal((await offerByLink(id, offerToken(id))).status, 'purchased');
    assert(!(await unavailableSkus(['CHEAP-1'])).has('CHEAP-1'), 'offer hold cleared');
    __setTestCookies(null);
  } finally { restore(); t.done(); __setTestCookies(null); }
});

test('counter, floor on the counter, decline, withdraw, and the per-unit override', async () => {
  const t = await withTestDb();
  arm();
  try {
    await query(`INSERT INTO products (sku, make, model, category, title, condition, price, cost, compare_at, active) VALUES
      ('CHEAP-1','LG','M1','Washer','LG Washer','Refurbished',800,400,1400,true),
      ('PRICEY-1','LG','M2','Washer','LG Pricey','Refurbished',500,480,900,true)`);
    const a = (await submitPublicOffer(guest())).id;
    await confirmOffer(a, offerToken(a));
    await rejects(() => decideOffer(a, 'counter', { price: 480 }, ADMIN), 'floor');
    equal((await decideOffer(a, 'counter', { price: 600 }, ADMIN)).status, 'countered');
    assert(!(await unavailableSkus(['CHEAP-1'])).has('CHEAP-1'), 'a counter holds nothing');
    await decideOffer(a, 'decline', {}, ADMIN);   // a countered offer can still be declined

    const b = (await submitPublicOffer(guest({ email: 'sam@example.com' }))).id;
    await confirmOffer(b, offerToken(b));
    await withdrawOffer({ token: offerToken(b) }, b);
    equal((await offerByLink(b, offerToken(b))).status, 'withdrawn');

    // force closed / force open
    await setOfferMode('CHEAP-1', 'closed', ADMIN);
    await rejects(() => submitPublicOffer(guest({ email: 'z@example.com' })), 'notopen');
    await setOfferMode('PRICEY-1', 'open', ADMIN);
    await rejects(() => submitPublicOffer(guest({ sku: 'PRICEY-1', amount: 450, email: 'z@example.com' })), 'price'); // open, but the floor still holds
    await setOfferMode('CHEAP-1', '', ADMIN);
  } finally { restore(); t.done(); }
});
