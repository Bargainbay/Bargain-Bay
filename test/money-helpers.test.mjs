// The small money helpers. Each is a handful of lines and each decides
// something a customer or a vendor sees.
import { suite, test, assert, equal } from './_harness.mjs';
import { splitAmount } from '../lib/stock-match.js';
import {
  round2, consignmentFloor, CONSIGNMENT_MIN_MARGIN_PCT,
  isUnitLine, isCreditLine, normalizeLineKind, HST_RATE, RESTOCKING_FEE_PCT
} from '../lib/constants.js';

suite('splitAmount — one typed line, several appliances');

test('the money adds back to the cent, always', () => {
  // "2x Frigidaire ... PRFS2883AFG/H" at $1,858.40 is ONE line for TWO fridges.
  // Linking splits it, and the split must not create or lose a penny.
  let broken = 0;
  for (let cents = 0; cents <= 50000; cents++) {
    for (const n of [1, 2, 3, 6, 7]) {
      const parts = splitAmount(cents / 100, n);
      if (Math.round(parts.reduce((a, b) => a + b, 0) * 100) !== cents) broken++;
    }
  }
  equal(broken, 0, 'splits that did not add back to the original');
});

test('the leftover goes on the LAST line', () => {
  // Documented: "divides in whole cents with the leftover on the LAST line".
  equal(splitAmount(100, 3), [33.33, 33.33, 33.34]);
  equal(splitAmount(1000, 6), [166.66, 166.66, 166.66, 166.66, 166.66, 166.70]);
});

test('an even split stays even', () => {
  equal(splitAmount(1858.40, 2), [929.20, 929.20]);
  equal(splitAmount(100, 1), [100]);
});

test('negatives split too — a credit line can be split as well', () => {
  const parts = splitAmount(-50, 2);
  equal(parts, [-25, -25]);
  equal(round2(parts.reduce((a, b) => a + b, 0)), -50);
});

test('nonsense counts do not produce nonsense splits', () => {
  equal(splitAmount(100, 0), [100], 'zero units is one unit');
  equal(splitAmount(100, -3), [100], 'negative units is one unit');
  equal(splitAmount(100, 2.7), [50, 50], 'a fractional count is floored');
  equal(splitAmount(null, 2), [0, 0]);
});

test('a single cent across two units gives one of them nothing', () => {
  // Correct, and worth pinning so nobody "fixes" it into 0.005 each.
  equal(splitAmount(0.01, 2), [0, 0.01]);
});

suite('consignmentFloor — a vendor gets paid whatever we sell it for');

test('the floor is cost + 20%, rounded UP', () => {
  equal(CONSIGNMENT_MIN_MARGIN_PCT, 20, 'the owner’s rule');
  equal(consignmentFloor(1000), 1200);
  equal(consignmentFloor(1250), 1500);
  equal(consignmentFloor(1600), 1920);
});

test('it rounds up, because a floor that rounds down is not a floor', () => {
  equal(consignmentFloor(100.01), 121, '120.012 -> 121');
  equal(consignmentFloor(0.5), 1, '0.6 -> 1');
});

test('a cost of zero floors nothing', () => {
  equal(consignmentFloor(0), 0);
  equal(consignmentFloor(null), 0);
  equal(consignmentFloor(undefined), 0);
  equal(consignmentFloor(-5), 0, 'a negative cost is not a floor either');
});

test('floating point does not inflate this one', () => {
  // The same trap that inflated the member floor by a dollar (see
  // test/pricing). It does not bite at 1.20, but it is cheap to pin — and
  // Phase 3.6 may well change the multiplier.
  let wrong = [];
  for (let cost = 1; cost <= 5000; cost++) {
    const want = Math.ceil(Math.round(cost * (100 + CONSIGNMENT_MIN_MARGIN_PCT)) / 100);
    if (consignmentFloor(cost) !== want) wrong.push(cost);
  }
  equal(wrong.slice(0, 5), [], `${wrong.length} integer costs floored wrong`);
});

suite('line kinds — what carries a SKU, a warranty and stock movement');

test('a missing kind means unit, because every pre-existing row has none', () => {
  // NULL = unit. Asked this way round on purpose: every test in the codebase
  // used to ask "is it a service?" with unit as the else, and two new kinds
  // broke that.
  assert(isUnitLine(undefined), 'undefined is a unit');
  assert(isUnitLine(null), 'null is a unit');
  assert(isUnitLine(''), 'empty is a unit');
  assert(isUnitLine('unit'));
  assert(!isUnitLine('service'));
  assert(!isUnitLine('discount'));
  assert(!isUnitLine('trade_in'));
});

test('credits are discounts and trade-ins, and nothing else', () => {
  assert(isCreditLine('discount'));
  assert(isCreditLine('trade_in'));
  assert(!isCreditLine('unit'), 'an appliance is not a credit');
  assert(!isCreditLine('service'), 'a haul-away is a CHARGE, not a trade-in');
  assert(!isCreditLine(null));
});

test('an unknown kind normalises to unit rather than being dropped', () => {
  equal(normalizeLineKind('unit'), 'unit');
  equal(normalizeLineKind('service'), 'service');
  equal(normalizeLineKind('discount'), 'discount');
  equal(normalizeLineKind('trade_in'), 'trade_in');
  equal(normalizeLineKind('nonsense'), 'unit');
  equal(normalizeLineKind(undefined), 'unit');
});

suite('the published rates');

test('HST and the restocking fee are what the policies say', () => {
  // RESTOCKING_FEE_PCT is published at /policies/returns. It is money we KEEP,
  // so it stays booked as revenue — changing it changes a published promise.
  equal(HST_RATE, 0.13);
  equal(RESTOCKING_FEE_PCT, 20);
});

test('round2 is Math.round on cents, WITH the usual binary caveat', () => {
  // round2(1.005) is 1.00, not 1.01 — because 1.005 * 100 is 100.49999999999999
  // in binary, so Math.round takes it down. That is the standard JavaScript
  // money-rounding caveat and it is pinned here rather than fixed.
  //
  // Not fixed because everything downstream is consistent WITH it and verified
  // against it: the tax invariants in test/tax hold to the cent across 200,000
  // values, and splitAmount adds back exactly. Changing round2 would move a
  // cent on an unknown number of historical invoices to satisfy a definition
  // nobody here depends on. If it is ever changed, those invariant tests are
  // what will say whether anything broke.
  // The caveat bites only where x*100 lands just BELOW the half in binary,
  // which is value-dependent — 2.675*100 is exactly 267.5 and rounds up, while
  // 1.005*100 is 100.49999999999999 and does not. Both measured, not assumed.
  equal(round2(1.005), 1.00, '1.005*100 = 100.49999999999999 -> down');
  equal(round2(2.675), 2.68, '2.675*100 = 267.5 exactly -> up');
  equal(round2(1.006), 1.01);
  equal(round2(1.004), 1.00);
  equal(round2(0), 0);
  equal(round2(-1.235), -1.24, '-1.235*100 = -123.50000000000001 -> away from zero');
  equal(round2(-1.005), -1, '-1.005*100 = -100.49999999999999 -> toward zero');
});
