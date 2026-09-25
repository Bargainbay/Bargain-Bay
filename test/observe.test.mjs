// lib/observe.js — the error reporter.
//
// The two properties that matter most are the ones easiest to get wrong and
// hardest to notice: it must never throw (it runs on the path that is already
// failing), and it must never ship a secret to a third party.
import http from 'node:http';
import { suite, test, assert, equal } from './_harness.mjs';
import { captureError, captureMessage, observeConfigured } from '../lib/observe.js';

suite('lib/observe — error reporting');

// A stand-in for Sentry's ingest endpoint.
let server, port, received = [];
async function listen() {
  received = [];
  server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers['x-sentry-auth'], ct: req.headers['content-type'], body: b });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"ok"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  process.env.SENTRY_DSN = `http://publickey123@127.0.0.1:${port}/42`;
  process.env.SENTRY_RELEASE = 'testrelease';
  process.env.SENTRY_ENVIRONMENT = 'test';
}
const close = () => new Promise((r) => (server ? server.close(r) : r()));
const lastEvent = () => JSON.parse(received[received.length - 1].body.trim().split('\n')[2]);

// A real error with a real stack.
function boom() { throw new Error('tracker read failed'); }
const thrown = () => { try { boom(); } catch (e) { return e; } };

// Each test gets a distinct fingerprint where it needs to bypass the 60s
// per-instance dedupe, which is otherwise shared across this whole file.
let n = 0;
const uniq = () => `t${++n}-${Math.random()}`;

test('is dormant with no SENTRY_DSN, and sends nothing', async () => {
  const saved = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    assert(observeConfigured() === false, 'observeConfigured should be false');
    const r = await captureError(new Error('should not send'));
    assert(r.skipped === true, 'should report skipped');
  } finally {
    if (saved) process.env.SENTRY_DSN = saved;
  }
});

test('posts a well-formed Sentry envelope', async () => {
  await listen();
  try {
    const r = await captureError(thrown(), { tags: { where: 'tracker-watch' }, fingerprint: uniq() });
    assert(r.ok === true, 'send should succeed');
    assert(/^[0-9a-f]{32}$/.test(r.eventId), 'event id should be 32 hex chars');
    equal(received[0].url, '/api/42/envelope/', 'ingest path');
    equal(received[0].ct, 'application/x-sentry-envelope', 'content type');
    assert(/sentry_key=publickey123/.test(received[0].auth), 'auth header carries the public key');

    const lines = received[0].body.trim().split('\n');
    equal(lines.length, 3, 'envelope is three NDJSON lines');
    const [hdr, item, ev] = lines.map((l) => JSON.parse(l));
    equal(hdr.event_id, ev.event_id, 'header event_id matches the event');
    equal(item.type, 'event', 'item header declares an event');
    equal(ev.exception.values[0].value, 'tracker read failed', 'message preserved');
    equal(ev.release, 'testrelease', 'release carried');
    equal(ev.environment, 'test', 'environment carried');
  } finally { await close(); }
});

test('parses the stack oldest-first and marks our own frames in_app', async () => {
  await listen();
  try {
    await captureError(thrown(), { fingerprint: uniq() });
    const frames = lastEvent().exception.values[0].stacktrace.frames;
    assert(frames.length > 0, 'should have frames');
    assert(/boom/.test(frames[frames.length - 1].function), 'throwing frame should be LAST (Sentry renders oldest-first)');
    assert(frames.some((f) => f.in_app === true), 'our own frames should be in_app');
  } finally { await close(); }
});

// The one that would cost real money to get wrong.
test('never ships a secret: query strings, cookies, auth headers, secret-shaped keys', async () => {
  await listen();
  try {
    await captureError(thrown(), {
      fingerprint: uniq(),
      extra: { vehicleId: 7, deviceToken: 'SUPERSECRET', apiKey: 'NOPE', note: 'x'.repeat(5000) },
      request: {
        url: 'https://bargainbay.ca/api/cron/tracker?key=CRONSECRET',
        method: 'POST',
        headers: new Headers({
          cookie: 'bb_session=SESSIONVALUE',
          authorization: 'Bearer BEARERVALUE',
          'x-twilio-signature': 'SIGVALUE',
          'user-agent': 'vercel-cron/1.0'
        })
      }
    });
    const body = received[received.length - 1].body;
    for (const secret of ['CRONSECRET', 'SESSIONVALUE', 'BEARERVALUE', 'SIGVALUE', 'SUPERSECRET', 'NOPE']) {
      assert(!body.includes(secret), `payload must not contain ${secret}`);
    }
    const ev = lastEvent();
    equal(ev.request.url, 'https://bargainbay.ca/api/cron/tracker?[stripped]', 'query string stripped');
    equal(ev.extra.deviceToken, '[redacted]', 'secret-shaped key redacted');
    equal(ev.extra.vehicleId, 7, 'ordinary value kept');
    equal(ev.extra.note.length, 1000, 'long value truncated');
    equal(ev.request.headers['user-agent'], 'vercel-cron/1.0', 'benign header kept');
    assert(ev.request.headers.cookie === undefined, 'cookie header dropped');
  } finally { await close(); }
});

test('throttles a loop of the same error but lets a different one through', async () => {
  await listen();
  try {
    const err = thrown();
    const fp = uniq();
    await captureError(err, { fingerprint: fp });
    const after = received.length;
    await captureError(err, { fingerprint: fp });
    await captureError(err, { fingerprint: fp });
    equal(received.length, after, 'repeats within the window are dropped');
    await captureError(new Error('a different failure'), { fingerprint: uniq() });
    equal(received.length, after + 1, 'a different error still reports');
  } finally { await close(); }
});

// It runs on the path that is already failing. It is not allowed to make it worse.
test('never throws: bad DSN, dead endpoint, non-Error input', async () => {
  const saved = process.env.SENTRY_DSN;
  try {
    process.env.SENTRY_DSN = 'not a url at all';
    assert((await captureError(new Error('x'), { fingerprint: uniq() })).ok === false, 'bad DSN returns cleanly');

    process.env.SENTRY_DSN = 'http://k@127.0.0.1:1/9'; // nothing listening
    assert((await captureError(new Error('y'), { fingerprint: uniq() })).ok === false, 'dead endpoint returns cleanly');

    await listen();
    await captureError('a bare string, not an Error', { fingerprint: uniq() });
    equal(lastEvent().exception.values[0].value, 'a bare string, not an Error', 'non-Error input is wrapped');
    await captureError(null, { fingerprint: uniq() });
    await close();
  } finally { process.env.SENTRY_DSN = saved; }
});

// The CDA watcher and the QBO sandbox were not crashes. They were silence.
test('captureMessage reports a condition, at warning level', async () => {
  await listen();
  try {
    await captureMessage('CDA watcher read 0 rows on its 40th consecutive run', {
      tags: { where: 'cda' }, fingerprint: uniq()
    });
    const ev = lastEvent();
    equal(ev.level, 'warning', 'a reported condition is a warning, not an error');
    assert(/40th consecutive/.test(ev.exception.values[0].value), 'message carried');
    assert(Array.isArray(ev.fingerprint), 'fingerprint carried so it groups as one issue');
  } finally { await close(); }
});
