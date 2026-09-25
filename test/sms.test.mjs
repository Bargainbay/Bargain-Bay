// lib/sms.js — which number a message goes out from.
//
// Twilio blocks a NUMBER PAIR at carrier level when somebody texts STOP, not a
// category of message. So the single property that matters here is that an
// advert can never go out on the number a driver's sign-in code arrives on —
// because an opt-out from the advert would then silently lock that driver out
// of the app, and nobody would find out until they were standing at a van.
import http from 'node:http';
import { suite, test, assert, equal } from './_harness.mjs';
import { sendSms, marketingFrom, smsMarketingConfigured, smsConfigured } from '../lib/sms.js';

suite('lib/sms — marketing never rides the operations number');

const OPS = '+15550000001';
const MKT = '+15550000002';

function twilioEnv() {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_FROM = OPS;
}
const clearMkt = () => { delete process.env.TWILIO_MARKETING_FROM; };

test('with no marketing number, marketingFrom falls back to operations', () => {
  twilioEnv(); clearMkt();
  equal(marketingFrom(), OPS, 'falls back rather than sending nothing');
  equal(smsMarketingConfigured(), false, 'and reports that it did');
});

test('a marketing number identical to the ops number does not count', () => {
  // Pasting the same number into both env vars is the obvious way to think you
  // have separated them without having done so.
  twilioEnv();
  process.env.TWILIO_MARKETING_FROM = OPS;
  equal(smsMarketingConfigured(), false, 'same number is not a separate number');
  clearMkt();
});

test('with a real marketing number, it is used and reported', () => {
  twilioEnv();
  process.env.TWILIO_MARKETING_FROM = MKT;
  equal(marketingFrom(), MKT);
  equal(smsMarketingConfigured(), true);
  clearMkt();
});

test('smsConfigured does NOT require a marketing number', () => {
  // Operational SMS must keep working before the second number is bought.
  twilioEnv(); clearMkt();
  equal(smsConfigured(), true, 'driver sign-in must not be gated on a marketing number');
});

suite('lib/sms — the wire');

// A stand-in for Twilio's REST API, so we can see the From we actually sent.
let server, port, sent = [], reply = { status: 201, body: { sid: 'SM1' } };
async function listen() {
  sent = [];
  server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      sent.push(Object.fromEntries(new URLSearchParams(b)));
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  // lib/sms builds the Twilio URL from the account SID, so point the SID at a
  // path on our stub rather than reaching for a network mock.
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  globalThis.fetch = (url, init) =>
    originalFetch(`http://127.0.0.1:${port}/`, init);
}
const originalFetch = globalThis.fetch;
const close = async () => { globalThis.fetch = originalFetch; await new Promise((r) => (server ? server.close(r) : r())); };

test('an omitted `from` defaults to OPERATIONS, never to marketing', async () => {
  twilioEnv(); process.env.TWILIO_MARKETING_FROM = MKT;
  await listen();
  try {
    await sendSms({ to: '+15551234567', body: 'your code is 123456' });
    equal(sent[0].From, OPS, 'a caller that says nothing gets the operations number');
  } finally { await close(); clearMkt(); }
});

test('an explicit `from` is honoured', async () => {
  twilioEnv(); process.env.TWILIO_MARKETING_FROM = MKT;
  await listen();
  try {
    await sendSms({ to: '+15551234567', body: 'deals!', from: marketingFrom() });
    equal(sent[0].From, MKT, 'marketing goes out on the marketing number');
  } finally { await close(); clearMkt(); }
});

test('Twilio 21610 is surfaced as optedOut, not as a generic failure', async () => {
  // This is the signal that somebody is carrier-blocked. Treated as an ordinary
  // error it would be retried forever and never explained; named, it is what
  // tells the office a driver is locked out.
  twilioEnv();
  await listen();
  reply = { status: 400, body: { code: 21610, message: 'Attempt to send to unsubscribed recipient' } };
  try {
    const r = await sendSms({ to: '+15551234567', body: 'hi' });
    equal(r.ok, false, 'still a failure');
    equal(r.optedOut, true, 'and specifically an opt-out');
  } finally {
    reply = { status: 201, body: { sid: 'SM1' } };
    await close();
  }
});

test('an ordinary failure is NOT reported as an opt-out', async () => {
  twilioEnv();
  await listen();
  reply = { status: 400, body: { code: 21211, message: 'Invalid To phone number' } };
  try {
    const r = await sendSms({ to: 'nonsense', body: 'hi' });
    equal(r.ok, false);
    assert(!r.optedOut, 'a bad number is not somebody opting out');
  } finally {
    reply = { status: 201, body: { sid: 'SM1' } };
    await close();
  }
});

test('with Twilio unconfigured it is a no-op, not a throw', async () => {
  const saved = process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_ACCOUNT_SID;
  try {
    const r = await sendSms({ to: '+1555', body: 'x' });
    equal(r.skipped, true, 'skipped cleanly');
  } finally { process.env.TWILIO_ACCOUNT_SID = saved; }
});
