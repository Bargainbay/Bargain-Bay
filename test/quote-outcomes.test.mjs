// lib/quotes.js — expiring a quote, and recording why it was lost.
//
// `expired` has been in the status CHECK and in the conversion logic since
// quotes were built, and NOTHING HAS EVER SET IT. Quotes sat `open` forever;
// expiry was enforced only at the moment a customer tried to accept one — by
// which point they have been told a price that is no longer offered. Any figure
// for "open quote value" counted every quote ever written.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { expireStaleQuotes, setQuoteLostReason, voidQuote, quoteOutcomes } from '../lib/quotes.js';
import { upsertCustomer } from '../lib/customers.js';
import { customerTasks, myDay } from '../lib/crm.js';
import { QUOTE_LOST_REASONS, isQuoteLostReason, torontoToday } from '../lib/constants.js';

const fresh = () => withTestDb();
const day = (offset) => {
  const d = new Date(`${torontoToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// Quotes are inserted directly: createQuote emails, prices against inventory
// and reaches three other modules, none of which this is about.
async function quote(client, { number, email = 'sam@example.ca', status = 'open', expires, total = 1200, createdAgo = 0 }) {
  const { rows } = await client.query(
    `INSERT INTO quotes (number, email, name, status, total, expires_at, created_at)
     VALUES ($1,$2,'Sam',$3,$4,$5, now() - ($6 || ' days')::interval) RETURNING id`,
    [number, email, status, total, expires ?? null, String(createdAgo)]
  );
  return rows[0].id;
}
const statusOf = async (client, id) =>
  (await client.query('SELECT status, expired_at, lost_reason FROM quotes WHERE id = $1', [id])).rows[0];

suite('quotes — the sweep that never existed');

test('an open quote past its date is expired', async () => {
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-1001', expires: day(-1) });
    const res = await expireStaleQuotes({ raiseFollowUps: false });
    equal(res.expired, 1);
    const q = await statusOf(client, id);
    equal(q.status, 'expired');
    assert(q.expired_at, 'when the sweep caught it — a six-week gap means it was not running');
  } finally { done(); }
});

test('a quote due TODAY is still live', async () => {
  // Expiring on the day would take a price off the table while the customer is
  // still looking at the email that offered it.
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-1002', expires: day(0) });
    equal((await expireStaleQuotes({ raiseFollowUps: false })).expired, 0);
    equal((await statusOf(client, id)).status, 'open');
  } finally { done(); }
});

test('A QUOTE WITH NO EXPIRY DATE IS LEFT ALONE', async () => {
  // Somebody wrote it deliberately without one. Guessing a date would close
  // deals that are still live.
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-1003', expires: null, createdAgo: 400 });
    equal((await expireStaleQuotes({ raiseFollowUps: false })).expired, 0);
    equal((await statusOf(client, id)).status, 'open');
  } finally { done(); }
});

test('only OPEN quotes are swept', async () => {
  const { client, done } = await fresh();
  try {
    const ids = {};
    for (const st of ['accepted', 'converted', 'void', 'expired']) {
      ids[st] = await quote(client, { number: `Q-${st}`, status: st, expires: day(-30) });
    }
    equal((await expireStaleQuotes({ raiseFollowUps: false })).expired, 0);
    for (const st of Object.keys(ids)) {
      equal((await statusOf(client, ids[st])).status, st, `${st} must be left alone`);
    }
  } finally { done(); }
});

test('running it twice expires nothing the second time', async () => {
  const { client, done } = await fresh();
  try {
    await quote(client, { number: 'Q-1004', expires: day(-5) });
    equal((await expireStaleQuotes({ raiseFollowUps: false })).expired, 1);
    equal((await expireStaleQuotes({ raiseFollowUps: false })).expired, 0);
  } finally { done(); }
});

suite('quotes — expiring raises a follow-up');

test('an expired quote puts an UNASSIGNED follow-up on everybody’s day', async () => {
  // A quote going stale is exactly the moment to ring somebody, and 2.4 gave us
  // somewhere to put that. Unassigned on purpose: the rep who wrote it may be
  // off, and an unowned follow-up shows on everyone's day rather than nobody's.
  const { client, done } = await fresh();
  try {
    const cid = await upsertCustomer({ email: 'sam@example.ca', name: 'Sam' });
    await quote(client, { number: 'Q-2001', email: 'sam@example.ca', expires: day(-1), total: 1200 });

    const res = await expireStaleQuotes();
    equal(res.expired, 1);
    equal(res.followUps, 1);

    const [task] = await customerTasks(cid);
    assert(/Q-2001/.test(task.title), 'the follow-up names the quote');
    equal(task.owner_email, null, 'unassigned');
    equal((await myDay({ email: 'anyone@rssolutions.ca' })).counts.unowned, 1, 'so everyone sees it');
  } finally { done(); }
});

test('a quote for somebody not on file still expires', async () => {
  // The follow-up is a nicety; expiring the quote is the job.
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-2002', email: 'stranger@nowhere.ca', expires: day(-1) });
    const res = await expireStaleQuotes();
    equal(res.expired, 1);
    equal(res.followUps, 0, 'nobody to attach it to');
    equal((await statusOf(client, id)).status, 'expired');
  } finally { done(); }
});

suite('quotes — why it was lost');

test('the reasons are a fixed list', () => {
  // Free text is one answer spelled four ways, which is four buckets.
  assert(isQuoteLostReason('price'));
  assert(isQuoteLostReason('no_answer'));
  assert(!isQuoteLostReason('too dear'));
  assert(!isQuoteLostReason(''));
  // "never heard back" and "said no" are different failures, and only the first
  // is something the shop can act on.
  assert(QUOTE_LOST_REASONS.no_answer && QUOTE_LOST_REASONS.changed_mind);
});

test('a reason can be put on an expired quote afterwards', async () => {
  // The sweep cannot ask anybody anything, so the answer arrives later than the
  // decision — which is why this is separate from closing it.
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-3001', expires: day(-1) });
    await expireStaleQuotes({ raiseFollowUps: false });
    await setQuoteLostReason(id, { reason: 'price', note: 'found one cheaper', by: 'rep@x.ca' });
    const q = await statusOf(client, id);
    equal(q.status, 'expired', 'the status does not change');
    equal(q.lost_reason, 'price');
  } finally { done(); }
});

test('a reason off the list is refused', async () => {
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-3002' });
    let err = null;
    try { await setQuoteLostReason(id, { reason: 'vibes' }); } catch (e) { err = e; }
    assert(err, 'should refuse');
  } finally { done(); }
});

test('a CONVERTED quote cannot be marked lost', async () => {
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-3003', status: 'converted' });
    let err = null;
    try { await setQuoteLostReason(id, { reason: 'price' }); } catch (e) { err = e; }
    assert(err, 'a won deal is not a lost one');
  } finally { done(); }
});

test('voiding can carry the reason in one go', async () => {
  const { client, done } = await fresh();
  try {
    const id = await quote(client, { number: 'Q-3004' });
    await voidQuote(id, { reason: 'bought_elsewhere', by: 'rep@x.ca' });
    const q = await statusOf(client, id);
    equal(q.status, 'void');
    equal(q.lost_reason, 'bought_elsewhere');
  } finally { done(); }
});

suite('quotes — won, lost and why');

test('the report counts won, lost and still live', async () => {
  const { client, done } = await fresh();
  try {
    await quote(client, { number: 'W1', status: 'converted', total: 1000 });
    await quote(client, { number: 'W2', status: 'converted', total: 500 });
    await quote(client, { number: 'L1', status: 'expired', total: 800 });
    await quote(client, { number: 'O1', status: 'open', total: 300 });

    const r = await quoteOutcomes({});
    equal(r.won, 2); equal(r.wonValue, 1500);
    equal(r.lost, 1); equal(r.lostValue, 800);
    equal(r.live, 1); equal(r.liveValue, 300);
    equal(Math.round(r.winRate * 100), 67, 'two of three closed quotes were won');
  } finally { done(); }
});

test('UNRECORDED IS A ROW, NOT A GAP', async () => {
  // The same rule the lead-source report follows. On the day this ships every
  // lost quote is unrecorded, and a report showing only the answered ones would
  // read as a complete picture of the year from its first hour.
  const { client, done } = await fresh();
  try {
    const a = await quote(client, { number: 'L1', status: 'expired', total: 800 });
    await quote(client, { number: 'L2', status: 'expired', total: 200 });
    await setQuoteLostReason(a, { reason: 'price' });

    const r = await quoteOutcomes({});
    equal(r.unrecorded, 1, 'the one nobody answered for');
    equal(r.unrecordedValue, 200, 'and what it was worth');
    equal(r.reasons.find((x) => x.key === 'price').n, 1);
  } finally { done(); }
});

test('every reason is listed even at zero', async () => {
  // "Nobody said it was price this quarter" is a real answer; an absent row is
  // not.
  const { done } = await fresh();
  try {
    const r = await quoteOutcomes({});
    equal(r.reasons.length, Object.keys(QUOTE_LOST_REASONS).length);
    assert(r.reasons.every((x) => x.n === 0));
    equal(r.winRate, null, 'no closed quotes is not a 0% win rate');
  } finally { done(); }
});
