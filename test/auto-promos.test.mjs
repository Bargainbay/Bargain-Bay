// lib/coupons autoDiscountFor: an automatic promotion must never be the reason
// something sells at a loss. Tiers are checked against real tracker figures
// (2026-10-08): WRT541SZDZ priced $987 against a $790.25 cost loses money at 20%.
import { suite, test, equal, assert } from './_harness.mjs';
import { autoDiscountFor } from '../lib/coupons.js';

const pct = (value) => ({ kind: 'percent', value });
const unit = (price, floor, eligible = true) => ({ price, floor, eligible });

suite('lib/coupons: automatic promotions are floored per unit');

test('a healthy margin takes the full percentage off', () => {
  const r = autoDiscountFor(pct(10), [unit(1200, 500)]);
  equal(r, { discount: 120, capped: false });
});

test('at 20% the unit that cannot spare it gives only what it can, never below cost', () => {
  // 987 * 20% = 197.40, but only 987 - 790.25 = 196.75 is above cost.
  const r = autoDiscountFor(pct(20), [unit(987, 790.25)]);
  equal(r, { discount: 196.75, capped: true });
});

test('consigned stock stops at cost + 20%, not at cost', () => {
  // Priced at 1800 against an agreed cost of 1250: floor is 1500, so 300 is spare.
  const r = autoDiscountFor(pct(20), [unit(1800, 1500)]);
  equal(r, { discount: 300, capped: true });
});

test('one thin unit does not stop the rest of the cart earning the full discount', () => {
  const r = autoDiscountFor(pct(15), [unit(2000, 800), unit(500, 499)]);
  // 300 on the first, 1 on the second (only $1 above cost).
  equal(r.discount, 301);
  assert(r.capped, 'the thin unit was capped');
});

test('clearance units are not discounted at all', () => {
  const r = autoDiscountFor(pct(10), [unit(1000, 400), unit(500, 100, false)]);
  equal(r.discount, 100);
});

test('an unknown cost (floor 0) floors nothing, matching every other cost check here', () => {
  const r = autoDiscountFor(pct(10), [unit(900, 0)]);
  equal(r, { discount: 90, capped: false });
});

test('a flat amount is capped by what the cart can spare', () => {
  const r = autoDiscountFor({ kind: 'amount', value: 200 }, [unit(1000, 900)]);
  equal(r, { discount: 100, capped: true });
});

test('a unit already at or under its floor gives nothing', () => {
  equal(autoDiscountFor(pct(10), [unit(700, 750)]), { discount: 0, capped: true });
});
