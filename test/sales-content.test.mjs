// lib/sales-content.js — John's pitches. They are only worth giving if every word can be honoured on job one, so this pins it:
// no blanks left to improvise, every price is the rate sheet, and nothing is promised that the rate sheet's own terms rule out.
import { suite, test, assert, equal } from './_harness.mjs';
import { SEGMENT_PITCHES, PRICE_LIST, WE_PROMISE, WE_DO_NOT, OBJECTIONS, FOLLOW_UP, PITCH, ZONES, leaveBehind } from '../lib/sales-content.js';
import { ADDONS } from '../lib/addons.js';
import { SEGMENTS, mergeTemplate } from '../lib/lead-rules.js';

const everyText = () => [
  PITCH, ...WE_PROMISE, FOLLOW_UP.subject, FOLLOW_UP.body,
  ...OBJECTIONS.flatMap((o) => [o.says, o.reply]),
  ...SEGMENT_PITCHES.flatMap((s) => [s.label, s.why, s.watch, ...s.offer, s.opener, s.smallYes, s.ifThey, s.email.subject, s.email.body]),
  ...PRICE_LIST.flatMap((p) => [p.item, p.price])
].join('\n');

suite('sales content — nothing to improvise');

test('no unfilled blanks: the only braces are the four merge fields, and no [brackets] or price placeholders', () => {
  const t = everyText();
  const braces = [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
  assert(braces.length > 0);
  for (const b of braces) assert(['first_name', 'company', 'rep_name', 'rep_phone'].includes(b), `unknown merge field {${b}}`);
  assert(!/\[[^\]]*\]/.test(t), 'a [bracket] placeholder is left');
  assert(!/\$X|\bXX\b|TBD|TODO/i.test(t), 'a price placeholder is left');
  equal(mergeTemplate('Hi {first_name}, {rep_name}', { first_name: 'Dana', rep_name: 'John' }), 'Hi Dana, John');
});

test('the prices are the rate sheet: zones and install add-ons come from one place', () => {
  equal(ZONES.map((z) => z.price), [95, 140, 225]);
  const shown = PRICE_LIST.map((x) => x.price).join(' | ');
  assert(shown.includes('$20'), 'haul-away is on the list');
  for (const key of ['laundry_install', 'laundry_stack', 'dishwasher_install', 'wall_oven_install', 'otr_install', 'gas_install']) {
    const a = ADDONS.find((x) => x.key === key);
    assert(a, `${key} exists in addons`);
    assert(shown.includes(`$${a.price}`), `${key} price $${a.price} is on the list`);
  }
});

suite('sales content — nothing the rate sheet rules out');

test('no same-day, next-day, emergency or 24-hour promise, and the real response time is stated', () => {
  // The objection reply and the do-not list are allowed to NAME these things in order to refuse them.
  const t = [PITCH, ...WE_PROMISE,
    ...SEGMENT_PITCHES.flatMap((s) => [s.why, s.watch, ...s.offer, s.opener, s.smallYes, s.ifThey, s.email.subject, s.email.body]),
    FOLLOW_UP.body].join('\n');
  assert(!/same[- ]day|next[- ]day|emergency|24[- ]hour|within the hour/i.test(t), 'a promise the rate sheet rules out');
  assert(WE_PROMISE.some((x) => /2–3 days/.test(x)), 'states 2–3 days');
  assert(WE_PROMISE.some((x) => /3:00 p\.m\./.test(x)), 'states the 3 p.m. cut-off');
  assert(WE_DO_NOT.some((x) => /same-day/i.test(x)), 'the do-not list says it out loud');
});

test('insured is claimed (confirmed); WSIB is never named in what a rep says, and restoration is on hold', () => {
  assert(WE_PROMISE.some((x) => /insured/i.test(x)));
  const spoken = SEGMENT_PITCHES.flatMap((s) => [s.why, s.watch, ...s.offer, s.opener, s.email.body]).join('\n');
  assert(!/WSIB/i.test(spoken), 'WSIB must not be mentioned until confirmed');
  assert(SEGMENT_PITCHES.find((s) => s.key === 'restoration').hold, 'restoration is held back');
});

test('every segment has an opener, a small yes and an email carrying its opt-out and mailing address', () => {
  equal(SEGMENT_PITCHES.length, 8);
  for (const s of SEGMENT_PITCHES) {
    assert(s.opener && s.smallYes && s.email.subject && s.email.body, s.key);
    assert(/reply STOP to unsubscribe/.test(s.email.body), `${s.key} email carries its opt-out`);
    assert(/1135 Squires Beach Rd/.test(s.email.body), `${s.key} email carries a mailing address`);
  }
  equal(SEGMENT_PITCHES.filter((s) => s.startNow).map((s) => s.key), ['property_management', 'retailer', 'contractor']);
});

test('every pitch segment exists in the Hub segment list, and the leave-behind builds for each live one', () => {
  const keys = new Set(SEGMENTS.map(([k]) => k));
  for (const s of SEGMENT_PITCHES) assert(keys.has(s.key), `${s.key} is a lead segment`);
  for (const s of SEGMENT_PITCHES.filter((x) => !x.hold)) {
    const lb = leaveBehind(s.key);
    assert(lb && lb.headline && lb.bullets.length && lb.prices.length && lb.promises.length, `${s.key} leave-behind`);
  }
});
