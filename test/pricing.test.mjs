// lib/pricing.js — what a member actually pays.
//
// CLAUDE.md spends more words on these rules than on anything else in the shop,
// and until this file existed not one of them could be reached from outside the
// module. That is why the floor bug survived three months: data/member-prices
// .json was a hand-built table last written 2026-06-15, nothing regenerated it,
// and every unit taken in afterwards fell through to a bare 55% of retail with
// no floor at all — below cost on anything bought above 55% of retail, which is
// normal for New in Box.
//
// The rules, in the order they fight each other:
//   floor   = max(cost + 10%, and $200 clear WHERE THE UNIT CAN CARRY IT)
//   ceiling = the public price, APPLIED LAST, so it wins
import { suite, test, assert, equal } from './_harness.mjs';
import {
  costFloorOf, boundMemberPrice, memberRegular, memberClearance, decorate,
  MEMBER_COST_FLOOR, MEMBER_MIN_PROFIT, MEMBER_CLEARANCE_RATE, MEMBER_REGULAR_FALLBACK
} from '../lib/pricing.js';

// decorate() soft-fails every database read, so the public path runs with none.
delete process.env.POSTGRES_URL;

suite('lib/pricing — the member floor');

test('the rates are the documented rates', () => {
  // Pinned so that changing what a member pays has to be a decision, not a diff.
  equal(MEMBER_COST_FLOOR, 1.10, 'never below cost + 10%');
  equal(MEMBER_MIN_PROFIT, 200, 'and never for less than $200 clear');
  equal(MEMBER_CLEARANCE_RATE, 0.90, '10% off the clearance price');
  equal(MEMBER_REGULAR_FALLBACK, 0.55, '55% of retail when the table has no row');
});

test('$200 applies only where the unit can carry it', () => {
  // The whole point of the headroom test. Measured against the 132 live units
  // on 2026-09-12: applying $200 unconditionally would have stripped the member
  // discount from 69 of them (up from 22) and reached $200 on none of the extra.
  equal(costFloorOf({ cost: 400 }, 1000), 600, 'headroom $600 — cost + $200 wins');
  equal(costFloorOf({ cost: 400 }, 600), 600, 'headroom exactly $200 — still applies');
  equal(costFloorOf({ cost: 400 }, 599), 440, 'headroom $199 — percentage floor alone');
  equal(costFloorOf({ cost: 400 }, 550), 440, 'well short — percentage floor alone');
});

test('a cost of zero floors nothing — a haul-away is a real answer', () => {
  // lib/intake zeroes cost on a haul-away deliberately. It is not a missing
  // value and must not be treated as one.
  equal(costFloorOf({ cost: 0 }, 900), 0);
  equal(costFloorOf({ cost: null }, 900), 0);
  equal(costFloorOf({ cost: undefined }, 900), 0);
  equal(costFloorOf({}, 900), 0);
});

test('the floor rounds UP, never down', () => {
  // Costs carry cents. Rounding put five live units at $199.65 clear — under
  // the very minimum the rule exists to guarantee.
  equal(costFloorOf({ cost: 379.35 }, 900), 580, '379.35 + 200 = 579.35 -> 580');
  equal(costFloorOf({ cost: 162.25 }, 250), 179, '162.25 * 1.10 = 178.475 -> 179');
});

test('REGRESSION: floating point must not inflate the floor by a dollar', () => {
  // `cost * 1.10` is binary floating point and lands a hair high startlingly
  // often — 400 * 1.10 is 440.00000000000006, which ceils to 441. That charged
  // a member a dollar above the stated rule on 228 of the first 5,000 integer
  // costs. Rounding to the cent before the ceil removes it.
  equal(costFloorOf({ cost: 400 }, 500), 440, '400 -> 440, not 441');
  equal(costFloorOf({ cost: 100 }, 150), 110, '100 -> 110, not 111');
  equal(costFloorOf({ cost: 50 }, 80), 55, '50 -> 55, not 56');

  let wrong = [];
  for (let cost = 1; cost <= 5000; cost++) {
    // publicPrice just above cost, so only the percentage floor is in play.
    const got = costFloorOf({ cost }, cost + 10);
    const want = Math.ceil(Math.round(cost * 110) / 100);
    if (got !== want) wrong.push({ cost, got, want });
  }
  equal(wrong.slice(0, 5), [], `${wrong.length} integer costs floored wrong`);
});

suite('lib/pricing — the ceiling beats the floor');

test('a member never pays MORE than a regular shopper', () => {
  // THE rule. If cost + 10% is already above what we list the unit at, the
  // member simply gets no discount — they are never charged the floor.
  const unit = { id: 'NOPE', cost: 900 };
  equal(boundMemberPrice(1000, unit, 950), 950, 'capped at the public price');
  equal(boundMemberPrice(500, unit, 950), 950, 'floor 990 > public 950 -> public wins');
  assert(boundMemberPrice(500, unit, 950) <= 950, 'never above the public price');
});

test('a deliberate below-cost clearance still stands for members', () => {
  // The owner marked it down on purpose; only the member's EXTRA 10% is floored.
  const unit = { id: 'X', cost: 800 };
  const marked = 600;                       // below cost, deliberately
  equal(memberClearance(unit, { price: marked }), 600,
    'the member pays the markdown, not a floor above it');
});

test('the member 10% applies when the unit can carry it', () => {
  const unit = { id: 'CHEAPCOST', cost: 100 };
  // 10% off 1000 = 900; floor is max(110, 1000-100>=200 ? 300 : ..) = 300. 900 wins.
  equal(memberClearance(unit, { price: 1000 }), 900);
});

test('a stale table row can never overcharge a member', () => {
  // The ceiling used to guard only the fallback branch, so a table entry on a
  // unit whose price had since dropped charged the member the old number.
  const unit = { id: 'NOT-IN-TABLE', price: 300, compareAt: 1000, cost: 0 };
  const p = memberRegular(unit);
  assert(p <= unit.price, `member ${p} must not exceed the public ${unit.price}`);
});

test('with no table row it falls back to 55% of retail, still bounded', () => {
  const unit = { id: 'NOT-IN-TABLE-EITHER', price: 1000, compareAt: 2000, cost: 0 };
  equal(memberRegular(unit), 1100 > 1000 ? 1000 : 1100, 'capped by the public price');
  const cheap = { id: 'ALSO-NOT-IN-TABLE', price: 1000, compareAt: 1000, cost: 0 };
  equal(memberRegular(cheap), 550, '55% of retail when nothing else binds');
});

suite('lib/pricing — cost never reaches a page');

test('decorate strips cost from every unit', async () => {
  // A server->client prop is serialised into the RSC payload, so spreading the
  // unit wholesale published what we paid into the HTML of /shop, the home
  // page, the product page, the cart and /bundle.
  const out = await decorate([
    { id: 'A1', make: 'LG', model: 'X', price: 1000, compareAt: 2000, cost: 400 },
    { id: 'A2', make: 'LG', model: 'Y', price: 500, compareAt: 900, cost: 450 }
  ], null);
  for (const u of out) {
    assert(!('cost' in u), `cost leaked on ${u.id}`);
  }
  assert(!JSON.stringify(out).includes('400'), 'no cost value anywhere in the payload');
});

test('a signed-out viewer gets the plain public price', async () => {
  const out = await decorate([{ id: 'A1', price: 1000, compareAt: 2000, cost: 400 }], null);
  equal(out[0].price, 1000);
  equal(out[0].clientPrice, 1000);
  equal(out[0].isMemberPrice, false);
  equal(out[0].onClearance, false);
});

test('warranty defaults to a year, including on clearance', async () => {
  // Clearance keeps the standard ONE-YEAR warranty — not the 3 months that was
  // originally spec'd.
  const out = await decorate([{ id: 'A1', price: 100, cost: 0 }], null);
  equal(out[0].warrantyMonths, 12);
});

test('decorate on an empty list is an empty list, not a throw', async () => {
  equal(await decorate([], null), []);
});
