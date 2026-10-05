// lib/deals-config + lib/giveaway: the promotion calendar and the entry rules.
//
// What matters here: the calendar is read in TORONTO time (the server is UTC),
// a deal held back until a time stays hidden until then, and one inbox is one
// ticket however it is spelled.
import { suite, test, assert, equal } from './_harness.mjs';
import {
  DEALS, DROPS, GIVEAWAY, isRunning, isUpcoming, dropFor, giveawayOpen,
  describeCoupon, bannerFor, torontoParts
} from '../lib/deals-config.js';
import { entryKey, postalPrefix } from '../lib/giveaway.js';

const at = (iso) => new Date(iso);
const deal = (id) => DEALS.find((d) => d.id === id);

suite('lib/deals-config: the calendar is Toronto time');

test('a deal ending Monday is still on at 9pm Monday Toronto, which is Tuesday UTC', () => {
  // 2026-10-13T01:00Z is 9pm on Oct 12 in Toronto (EDT, UTC-4).
  assert(isRunning(deal('hosting'), at('2026-10-13T01:00:00Z')));
  assert(!isRunning(deal('hosting'), at('2026-10-13T05:00:00Z')), 'gone by midnight Toronto');
});

test('the Halloween flash is hidden until 5pm Toronto on its first day', () => {
  const h = deal('halloween');
  assert(!isRunning(h, at('2026-10-30T20:59:00Z')), '4:59pm EDT');
  assert(isRunning(h, at('2026-10-30T21:00:00Z')), '5:00pm EDT');
  assert(isRunning(h, at('2026-10-31T15:00:00Z')));
});

test('a held-back deal is not announced as upcoming on its own day', () => {
  // It is meant to be a surprise; before the day it may be listed, on the day it may not.
  const h = deal('halloween');
  assert(!isUpcoming(h, at('2026-10-20T16:00:00Z')), 'not teased three weeks out');
  assert(isUpcoming(h, at('2026-10-29T16:00:00Z')));
  assert(!isUpcoming(h, at('2026-10-30T16:00:00Z')));
});

test('there is never a gap or a double booking in the weekly drops', () => {
  for (let i = 1; i < DROPS.length; i++) {
    const prev = new Date(DROPS[i - 1].to + 'T00:00:00Z');
    const next = new Date(DROPS[i].from + 'T00:00:00Z');
    equal((next - prev) / 86400000, 1, `drop ${i} starts the day after drop ${i - 1} ends`);
  }
  equal(dropFor(at('2026-10-14T16:00:00Z')).sku, 'RS-0608-046');
});

test('the giveaway window and its draw date agree', () => {
  assert(giveawayOpen(at('2026-10-06T14:00:00Z')));
  assert(!giveawayOpen(at('2026-10-05T14:00:00Z')));
  assert(giveawayOpen(at('2026-10-13T01:00:00Z')), '9pm Oct 12 Toronto is still open');
  assert(!giveawayOpen(at('2026-10-13T05:00:00Z')));
  assert(GIVEAWAY.drawDate > GIVEAWAY.to);
});

test('torontoParts reports the Toronto clock', () => {
  equal(torontoParts(at('2026-10-30T21:00:00Z')), { date: '2026-10-30', time: '17:00' });
});

suite('lib/deals-config: the words come from the coupon');

test('describes a dollar code with a minimum', () => {
  equal(describeCoupon({ kind: 'amount', value: 75, minSubtotal: 750 }), '$75 off orders of $750 or more');
});
test('describes a percent code with no minimum', () => {
  equal(describeCoupon({ kind: 'percent', value: 15, minSubtotal: 0 }), '15% off your order');
});

test('the banner leads with the soonest-ending deal and adds the giveaway as a second link', () => {
  const snap = {
    active: [{ title: 'Laundry Week', coupon: { code: 'LAUNDRY100', kind: 'amount', value: 100, minSubtotal: 1000 } }],
    giveaway: true
  };
  const b = bannerFor(snap);
  assert(b.text.includes('LAUNDRY100') && b.text.includes('$100 off'));
  equal(b.href, '/deals');
  equal(b.extra.href, '/giveaway');
});
test('no deal and no giveaway means no banner (the header falls back to its own line)', () => {
  equal(bannerFor({ active: [], giveaway: false }), null);
});

suite('lib/giveaway: one inbox, one ticket');

test('plus-tags and case collapse to one key', () => {
  equal(entryKey('Me+twenty@Example.com'), 'me@example.com');
  equal(entryKey(' me@example.com '), 'me@example.com');
});
test('gmail dots are NOT collapsed (other providers treat them as different people)', () => {
  assert(entryKey('a.b@x.com') !== entryKey('ab@x.com'));
});
test('garbage has no key', () => {
  equal(entryKey('not-an-email'), null);
  equal(entryKey(''), null);
  equal(entryKey('+tag@x.com'), null);
});
test('only Ontario postal prefixes pass, so Quebec stays out', () => {
  equal(postalPrefix('l1w 3t9'), 'L1W');
  equal(postalPrefix('M1B 2K3'), 'M1B');
  equal(postalPrefix('H2X 1Y4'), null, 'Montreal');
  equal(postalPrefix('V6B 1A1'), null, 'Vancouver');
  equal(postalPrefix(''), null);
});

suite('lib/giveaway: entering and drawing, against a real Postgres');

import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { enterGiveaway, drawWinner, resolveWinner, giveawayOverview } from '../lib/giveaway.js';
const G = 'test-giveaway';
const person = (n, o = {}) => ({ name: `P${n}`, email: `p${n}@example.com`, postal: 'L1W 3T9', eligible: true, ...o });

test('one entry per inbox; the repeat is told it is already in, not refused', async () => {
  const { done } = await withTestDb();
  try {
    equal((await enterGiveaway(G, person(1))).entered, true);
    const again = await enterGiveaway(G, person(1, { email: 'P1+second@Example.com' }));
    equal(again.ok, true);
    equal(again.entered, false);
    equal((await giveawayOverview(G)).total, 1);
  } finally { done(); }
});

test('refuses non-Ontario postal codes, a missing eligibility tick, and a bad email', async () => {
  const { done } = await withTestDb();
  try {
    assert(!(await enterGiveaway(G, person(1, { postal: 'H2X 1Y4' }))).ok);
    assert(!(await enterGiveaway(G, person(2, { eligible: false }))).ok);
    assert(!(await enterGiveaway(G, person(3, { email: 'nope' }))).ok);
    equal((await giveawayOverview(G)).total, 0);
  } finally { done(); }
});

test('the same connection cannot flood the draw', async () => {
  const { done } = await withTestDb();
  try {
    for (let i = 0; i < 5; i++) assert((await enterGiveaway(G, person(i), { ip: '1.2.3.4' })).ok);
    const sixth = await enterGiveaway(G, person(9), { ip: '1.2.3.4' });
    assert(!sixth.ok, 'sixth entry from one IP in an hour is refused');
  } finally { done(); }
});

test('a draw picks an entrant, and will not pick a second winner while one is waiting', async () => {
  const { done } = await withTestDb();
  try {
    for (let i = 0; i < 4; i++) await enterGiveaway(G, person(i));
    const { winner } = await drawWinner(G, 'admin@x.ca');
    assert(/^P\d$/.test(winner.name));
    let msg = '';
    try { await drawWinner(G, 'admin@x.ca'); } catch (e) { msg = e.message; }
    assert(msg.includes('already a winner'), 'double-click must not make two winners');
  } finally { done(); }
});

test('a forfeited winner is never drawn again, and the redraw comes from who is left', async () => {
  const { done } = await withTestDb();
  try {
    for (let i = 0; i < 3; i++) await enterGiveaway(G, person(i));
    const seen = new Set();
    for (let round = 0; round < 3; round++) {
      const { winner } = await drawWinner(G, 'a');
      assert(!seen.has(winner.id), 'nobody is drawn twice');
      seen.add(winner.id);
      await resolveWinner(G, winner.id, 'forfeited', 'no answer', 'a');
    }
    let msg = '';
    try { await drawWinner(G, 'a'); } catch (e) { msg = e.message; }
    assert(msg.includes('no eligible entries'), 'the pot is empty once everyone has forfeited');
  } finally { done(); }
});

test('only a current winner can be resolved', async () => {
  const { done } = await withTestDb();
  try {
    await enterGiveaway(G, person(1));
    const { rows } = await query('SELECT id FROM giveaway_entries');
    let msg = '';
    try { await resolveWinner(G, rows[0].id, 'claimed', '', 'a'); } catch (e) { msg = e.message; }
    assert(msg.includes('not a current winner'));
  } finally { done(); }
});
