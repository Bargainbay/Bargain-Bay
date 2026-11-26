// The website's only way onto the deal-text list: lib/sms-subscribe.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { subscribeToTexts, textableNumber, WELCOME_TEXT } from '../lib/sms-subscribe.js';
import { filterAudience, withdrawConsent } from '../lib/consent.js';
import { marketingAudience } from '../lib/customers.js';

delete process.env.SENTRY_DSN;

suite('lib/sms-subscribe — joining the deal-text list');

test('only a real 10-digit North American number is textable', () => {
  equal(textableNumber('(437) 488-8549'), '+14374888549');
  equal(textableNumber('12345'), null);
  equal(textableNumber('0000000000'), null);
  equal(textableNumber(''), null);
});

test('the confirmation text is one segment and says how to stop', () => {
  assert(WELCOME_TEXT.length <= 160, String(WELCOME_TEXT.length));
  assert(/STOP/.test(WELCOME_TEXT) && /^Bargain Bay/.test(WELCOME_TEXT));
});

test('a new number is texted once, from the marketing number; a repeat is not', async () => {
  const keys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MARKETING_FROM', 'VERCEL_ENV'];
  const before = keys.map((k) => process.env[k]);
  const realFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550000001', TWILIO_MARKETING_FROM: '+15550000002', VERCEL_ENV: 'production' });
  globalThis.fetch = async (url, opts) => { calls.push(String(opts?.body)); return new Response('{"sid":"SM1"}', { status: 201 }); };
  const { done } = await withTestDb();
  try {
    await subscribeToTexts({ phone: '4374888549', where: 'the test' });
    await subscribeToTexts({ phone: '4374888549', where: 'the test' });
    equal(calls.length, 1, 'one text');
    equal(new URLSearchParams(calls[0]).get('From'), '+15550000002', 'marketing number');
  } finally {
    done(); globalThis.fetch = realFetch;
    keys.forEach((k, i) => { if (before[i] === undefined) delete process.env[k]; else process.env[k] = before[i]; });
  }
});

test('subscribing records consent once and puts the number in the campaign audience', async () => {
  const { client, done } = await withTestDb();
  try {
    const a = await subscribeToTexts({ phone: '437 488 8549', where: 'the test' });
    equal(a.subscribed, true);
    await subscribeToTexts({ phone: '4374888549', where: 'the test' });
    const ev = await client.query(`SELECT * FROM consent_events WHERE channel = 'sms'`);
    equal(ev.rows.length, 1, 'no duplicate consent');
    assert(/Reply STOP/.test(ev.rows[0].evidence), 'the wording is the evidence');
    const gate = await filterAudience(await marketingAudience('all'), 'sms');
    equal(gate.allowed.length, 1, 'a campaign would reach them, once');
  } finally { done(); }
});

test('a number that opted out is not turned back on from the website', async () => {
  const { done } = await withTestDb();
  try {
    await withdrawConsent({ channel: 'sms', phone: '4374888549', source: 'sms_stop' });
    const r = await subscribeToTexts({ phone: '4374888549', where: 'the test' });
    equal(r.subscribed, false);
    const gate = await filterAudience([{ phone: '4374888549' }], 'sms');
    equal(gate.allowed.length, 0);
  } finally { done(); }
});
