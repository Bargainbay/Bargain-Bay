// lib/abandoned-cart-emails.js — the staff digest and the CASL-gated reminder sequence.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { recordCart } from '../lib/abandoned-carts.js';
import { grantConsent, withdrawConsent } from '../lib/consent.js';
import { notifyStaffOfAbandonedCarts, sendCartReminders, dueStep, reminderEmail } from '../lib/abandoned-cart-emails.js';

const age = (token, hours) =>
  query(`UPDATE cart_sessions SET updated_at = now() - ($2::numeric * interval '1 hour') WHERE token = $1`, [token, hours]);
const unit = (sku, price = 500) =>
  query(`INSERT INTO products (sku, make, model, title, price, active) VALUES ($1,'LG','M1',$2,$3,true)`, [sku, `Fridge ${sku}`, price]);
const cart = (token, email, skus = ['A1'], hours = 5) =>
  recordCart({ token, skus, email, name: 'Sam Lee' }).then(() => age(token, hours));
const recorder = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); return { ok: true }; } }; };
const prod = async (fn) => {
  const was = process.env.VERCEL_ENV; process.env.VERCEL_ENV = 'production';
  try { return await fn(); } finally { if (was === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = was; }
};
const rows = () => query(`SELECT cart_id, step, status FROM abandoned_cart_emails ORDER BY step`).then((r) => r.rows);

suite('Abandoned-cart reminders');

test('dueStep: highest step whose time has come, none once the sequence is over', () => {
  equal([3.9, 4, 23.9, 24, 71.9, 72, 83.9, 84.1].map(dueStep), [0, 1, 1, 2, 2, 3, 3, 0]);
});

test('staff get ONE digest for several carts, once, with the dashboard link', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await unit('A2');
      await cart('tok-dig-00001', 'a@x.ca'); await cart('tok-dig-00002', 'b@x.ca', ['A2']);
      const r = recorder();
      const out = await notifyStaffOfAbandonedCarts({ send: r.send });
      equal(r.sent.length, 1);
      equal(out.carts, 2);
      assert(r.sent[0].html.includes('/admin/dashboard'));
      assert(r.sent[0].html.includes('a@x.ca') && r.sent[0].html.includes('b@x.ca'));
      await notifyStaffOfAbandonedCarts({ send: r.send });
      equal(r.sent.length, 1, 'not told twice');
    });
  } finally { done(); }
});

test('a failed digest is retried next pass; a cart with nothing left raises none', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1');
      await cart('tok-dig-00003', 'a@x.ca');
      await notifyStaffOfAbandonedCarts({ send: async () => ({ ok: false }) });
      const r = recorder();
      await notifyStaffOfAbandonedCarts({ send: r.send });
      equal(r.sent.length, 1);
      await query(`UPDATE products SET active=false`);
      await query(`UPDATE cart_sessions SET notified_at = NULL`);
      await notifyStaffOfAbandonedCarts({ send: r.send });
      equal(r.sent.length, 1, 'nothing to sell, nothing to tell');
    });
  } finally { done(); }
});

test('reminders are OFF unless switched on', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await cart('tok-rem-00001', 'a@x.ca');
      await grantConsent({ channel: 'email', email: 'a@x.ca', source: 'checkout', evidence: 'x' });
      const r = recorder();
      const out = await sendCartReminders({ send: r.send, hour: 10 });
      equal(out.reason, 'off'); equal(r.sent.length, 0);
    });
  } finally { done(); }
});

test('each step fires once at the right age, with unsubscribe headers and a cart link', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1');
      await cart('tok-rem-00002', 'a@x.ca', ['A1'], 3);
      await grantConsent({ channel: 'email', email: 'a@x.ca', source: 'checkout', evidence: 'x' });
      const r = recorder(); const go = () => sendCartReminders({ send: r.send, hour: 10, force: true });
      await go(); equal(r.sent.length, 0, '3h: too early');
      await age('tok-rem-00002', 5); await go(); await go();
      equal(r.sent.length, 1, '4h step, once even when run twice');
      const m = r.sent[0];
      assert(m.html.includes('/cart') && m.html.includes('Fridge A1') && m.html.includes('/unsubscribe'));
      assert(m.html.includes('someone else may buy it'));
      assert(m.headers['List-Unsubscribe'].includes('/unsubscribe'));
      equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      await age('tok-rem-00002', 25); await go(); await go();
      equal(r.sent.length, 2, '24h step');
      await age('tok-rem-00002', 73); await go(); await go();
      equal(r.sent.length, 3, '72h step');
      equal((await rows()).map((x) => x.status), ['sent', 'sent', 'sent']);
      await age('tok-rem-00002', 100); await go();
      equal(r.sent.length, 3, 'sequence is over');
    });
  } finally { done(); }
});

test('after an outage only the latest due step goes; the overtaken one is recorded, not sent', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await cart('tok-rem-00003', 'a@x.ca', ['A1'], 26);
      await grantConsent({ channel: 'email', email: 'a@x.ca', source: 'checkout', evidence: 'x' });
      const r = recorder();
      await sendCartReminders({ send: r.send, hour: 10, force: true });
      equal(r.sent.length, 1);
      equal((await rows()).map((x) => `${x.step}:${x.status}`), ['1:skipped', '2:sent']);
    });
  } finally { done(); }
});

test('no consent, opted out, bought, closed, sold, overnight: nothing is sent', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      for (const s of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) await unit(s);
      await cart('tok-no-000001', 'none@x.ca', ['A1']);                       // no consent on record
      await cart('tok-no-000002', 'out@x.ca', ['A2']);                        // withdrew
      await grantConsent({ channel: 'email', email: 'out@x.ca', source: 'checkout', evidence: 'x' });
      await withdrawConsent({ channel: 'email', email: 'out@x.ca', source: 'unsubscribe_link' });
      await cart('tok-no-000003', 'bought@x.ca', ['A3']);                     // consent, but bought
      await grantConsent({ channel: 'email', email: 'bought@x.ca', source: 'checkout', evidence: 'x' });
      await query(`INSERT INTO orders (email, status) VALUES ('bought@x.ca','confirmed')`);
      await cart('tok-no-000004', 'closed@x.ca', ['A4']);                     // emptied
      await grantConsent({ channel: 'email', email: 'closed@x.ca', source: 'checkout', evidence: 'x' });
      await recordCart({ token: 'tok-no-000004', skus: [] });
      await cart('tok-no-000005', 'sold@x.ca', ['A5']);                       // unit gone
      await grantConsent({ channel: 'email', email: 'sold@x.ca', source: 'checkout', evidence: 'x' });
      await query(`UPDATE products SET active=false WHERE sku='A5'`);
      await cart('tok-no-000006', 'night@x.ca', ['A6']);                      // fine, but 3am
      await grantConsent({ channel: 'email', email: 'night@x.ca', source: 'checkout', evidence: 'x' });
      const r = recorder();
      const out = await sendCartReminders({ send: r.send, hour: 10, force: true });
      equal(r.sent.map((m) => m.to), ['night@x.ca'], 'only the consented, unbought, open, available cart');
      equal(out.sent, 1);
      const night = await sendCartReminders({ send: r.send, hour: 3, force: true });
      equal(night.reason, 'quiet hours');
    });
  } finally { done(); }
});

test('implied consent from a recent purchase is honoured', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await cart('tok-imp-00001', 'buyer@x.ca');
      await query(`INSERT INTO orders (email, status, created_at) VALUES ('buyer@x.ca','delivered', now() - interval '30 days')`);
      await query(`UPDATE cart_sessions SET created_at = now() - interval '6 hours'`);
      const r = recorder();
      await sendCartReminders({ send: r.send, hour: 10, force: true });
      // the purchase pre-dates the cart, so BOUGHT does not stop it, and it implies consent
      equal(r.sent.length, 1);
      assert(r.sent[0].html.includes('You bought from us'));
    });
  } finally { done(); }
});

test('a send failure is recorded, not retried, and does not stop the pass', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await unit('A2');
      await cart('tok-fail-0001', 'a@x.ca', ['A1']); await cart('tok-fail-0002', 'b@x.ca', ['A2']);
      for (const e of ['a@x.ca', 'b@x.ca']) await grantConsent({ channel: 'email', email: e, source: 'checkout', evidence: 'x' });
      const sent = [];
      const send = async (m) => { if (m.to === 'a@x.ca') throw new Error('boom'); sent.push(m.to); return { ok: true }; };
      const out = await sendCartReminders({ send, hour: 10, force: true });
      equal(sent, ['b@x.ca']); equal(out.failed, 1); equal(out.sent, 1);
      const again = await sendCartReminders({ send, hour: 10, force: true });
      equal(again.sent, 0, 'not retried');
    });
  } finally { done(); }
});

test('a refilled cart is a new sequence', async () => {
  const { done } = await withTestDb();
  try {
    await prod(async () => {
      await unit('A1'); await cart('tok-gen-00001', 'a@x.ca');
      await grantConsent({ channel: 'email', email: 'a@x.ca', source: 'checkout', evidence: 'x' });
      const r = recorder();
      await sendCartReminders({ send: r.send, hour: 10, force: true });
      await recordCart({ token: 'tok-gen-00001', skus: [] });
      await recordCart({ token: 'tok-gen-00001', skus: ['A1'] });
      await age('tok-gen-00001', 5);
      await sendCartReminders({ send: r.send, hour: 10, force: true });
      equal(r.sent.length, 2);
    });
  } finally { done(); }
});

test('NON-PRODUCTION: nothing real is sent and no step is used up', async () => {
  const { done } = await withTestDb();
  const keys = ['VERCEL_ENV', 'STAGING_EMAIL_TO', 'RESEND_API_KEY', 'ALLOW_REAL_OUTBOUND'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch; const calls = [];
  try {
    delete process.env.VERCEL_ENV; delete process.env.STAGING_EMAIL_TO; delete process.env.ALLOW_REAL_OUTBOUND;
    process.env.RESEND_API_KEY = 're_test';
    globalThis.fetch = async (...a) => { calls.push(a); return { ok: true, status: 200, text: async () => '{}' }; };
    await unit('A1'); await cart('tok-env-00001', 'a@x.ca');
    await grantConsent({ channel: 'email', email: 'a@x.ca', source: 'checkout', evidence: 'x' });
    const staff = await notifyStaffOfAbandonedCarts();            // real sendEmail
    const rem = await sendCartReminders({ hour: 10, force: true }); // real sendEmail
    equal(calls.length, 0, 'no request reached Resend');
    equal(staff.notified, 0); equal(rem.sent, 0);
    equal((await rows()).length, 0, 'step handed back for production');
    equal((await query(`SELECT notified_at FROM cart_sessions`)).rows[0].notified_at, null);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    done();
  }
});

test('the email names the sender, never claims a countdown', () => {
  const { html } = reminderEmail({ cart: { email: 'a@x.ca', name: 'Sam', units: [{ state: 'available', title: 'Fridge', price: 10 }] }, step: 3, basis: 'express' });
  assert(html.includes('Bargain Bay') && html.includes('Unsubscribe'));
  assert(!/hours? left|expires|only \d+ left/i.test(html));
});

suite('Sign in with Google/Microsoft opt-in');
import { recordOAuthOptIn } from '../lib/oauth.js';
import { consentStatus } from '../lib/consent.js';

test('consent is recorded only for a NEW account that ticked the box', async () => {
  const { done } = await withTestDb();
  try {
    const st = async (e) => (await consentStatus([e], 'email')).get(e).basis;
    equal(await recordOAuthOptIn({ created: true, optin: false, email: 'a@x.ca', provider: 'google' }), false);
    equal(await recordOAuthOptIn({ created: false, optin: true, email: 'b@x.ca', provider: 'google' }), false);
    equal(await st('a@x.ca'), 'none'); equal(await st('b@x.ca'), 'none');
    equal(await recordOAuthOptIn({ created: true, optin: true, email: 'c@x.ca', provider: 'microsoft' }), true);
    equal(await st('c@x.ca'), 'express');
    const ev = (await query(`SELECT evidence, source FROM consent_events WHERE identity='c@x.ca'`)).rows[0];
    assert(ev.evidence.includes('Email me occasional deals') && ev.evidence.includes('microsoft'));
  } finally { done(); }
});

suite('Checkout capture-time opt-in');
import { POST as capturePost } from '../app/api/cart-capture/route.js';
const post = (body) => capturePost({ json: async () => body, headers: new Headers() });

test('ticking the box at checkout records consent with OUR wording; unticking withdraws', async () => {
  const { done } = await withTestDb();
  try {
    await unit('A1');
    const base = { token: 'tok-opt-00001', skus: ['A1'], email: 'Shopper@X.ca' };
    await post({ ...base, marketingOptIn: true, marketingOptInText: 'client-made-up wording' });
    const st = async () => (await consentStatus(['shopper@x.ca'], 'email')).get('shopper@x.ca').basis;
    equal(await st(), 'express');
    const ev = (await query(`SELECT evidence, source FROM consent_events`)).rows[0];
    assert(ev.evidence.includes('Email me occasional deals') && !ev.evidence.includes('made-up'));
    await post({ ...base, marketingOptIn: false });
    equal(await st(), 'withdrawn');
    await post({ token: 'tok-opt-00002', skus: ['A1'], email: 'plain@x.ca' });   // box never touched
    equal((await consentStatus(['plain@x.ca'], 'email')).get('plain@x.ca').basis, 'none');
  } finally { done(); }
});
