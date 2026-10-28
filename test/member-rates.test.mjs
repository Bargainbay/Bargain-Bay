// The member price knobs: what may be typed, what is stored, and that the floor and ceiling still
// bound whatever the owner chooses. The pinned defaults live in pricing.test.mjs.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { DEFAULT_MEMBER_RATES, normalizeRates, toPercent, fromPercent } from '../lib/member-rate-rules.js';
import { getMemberRates, saveMemberRates, setOverride, removeOverride, clearMemberRatesCache } from '../lib/member-rates.js';
import { memberRegular, memberClearance, costFloorOf, unitPrices } from '../lib/pricing.js';

suite('member rates — what may be typed');

test('percentages convert without floating point residue', () => {
  equal(fromPercent(55), 0.55);
  equal(toPercent(0.55), 55);
  equal(fromPercent(110), 1.1);
  equal(toPercent(1.1), 110);
});

test('a rate outside its limits is refused and names the field', () => {
  assert(normalizeRates({ costFloor: 0.9 }).error, 'cost floor below 100% of cost would allow a sale under cost');
  assert(normalizeRates({ regularRate: 0.1 }).error, 'a typo cannot put the shop at 10% of retail');
  assert(normalizeRates({ regularRate: 1.5 }).error, 'members cannot be charged more than retail');
  assert(normalizeRates({ minProfit: -5 }).error);
  assert(normalizeRates({ minProfit: 'abc' }).error);
});

test('a field left out keeps its current value', () => {
  const r = normalizeRates({ regularRate: 0.5 });
  equal(r.rates.regularRate, 0.5);
  equal(r.rates.clearanceRate, DEFAULT_MEMBER_RATES.clearanceRate);
  equal(r.rates.minProfit, DEFAULT_MEMBER_RATES.minProfit);
});

suite('member rates — they change the price, and the bounds still hold');

const unit = { id: 'U1', price: 1000, compareAt: 2000, cost: 400 };

test('a lower regular rate lowers the member price', () => {
  const r = normalizeRates({ regularRate: 0.60 }).rates;
  equal(memberRegular(unit, r), 1000, '60% of 2000 = 1200, capped at the public 1000');
  const cheap = { id: 'U2', price: 1500, compareAt: 1500, cost: 400 };
  equal(memberRegular(cheap, normalizeRates({ regularRate: 0.60 }).rates), 900);
  equal(memberRegular(cheap, normalizeRates({ regularRate: 0.70 }).rates), 1050);
});

test('however low the rate, the floor holds', () => {
  const r = normalizeRates({ regularRate: 0.30 }).rates;          // 30% of 2000 = 600
  equal(memberRegular(unit, r), 600, 'cost 400 + $200 = 600 is the floor');
  const lowest = normalizeRates({ regularRate: 0.30, minProfit: 0, costFloor: 1.0 }).rates;
  equal(memberRegular(unit, lowest), 600, 'with no floor margin the percentage stands');
  equal(costFloorOf(unit, 1000, normalizeRates({ costFloor: 1.0, minProfit: 0 }).rates), 400, 'floor at cost, never under');
});

test('a typed override is held between the floor and the public price', () => {
  const r = DEFAULT_MEMBER_RATES;
  equal(memberRegular(unit, r, { U1: 700 }), 700, 'inside the bounds it stands');
  equal(memberRegular(unit, r, { U1: 10 }), 600, 'too low is lifted to the floor');
  equal(memberRegular(unit, r, { U1: 99999 }), 1000, 'too high is capped at the public price');
});

test('a typed override applies to a clearance unit, held between the floor and the clearance price', () => {
  const r = DEFAULT_MEMBER_RATES;
  const cl = { price: 1000 };
  equal(unitPrices(unit, { cl, member: true, rates: r, overrides: { U1: 700 } }).price, 700, 'typed price stands');
  equal(unitPrices(unit, { cl, member: true, rates: r, overrides: { U1: 10 } }).price, 600, 'lifted to the floor');
  equal(unitPrices(unit, { cl, member: true, rates: r, overrides: { U1: 99999 } }).price, 1000, 'capped at the clearance price');
  equal(unitPrices(unit, { cl, member: true, rates: r, overrides: {} }).price, 900, 'no typed price: the usual 90%');
  equal(unitPrices(unit, { cl, member: false, rates: r, overrides: { U1: 700 } }).price, 1000, 'the public never sees it');
});

test('a clearance rate change moves only the member cut', () => {
  const r = normalizeRates({ clearanceRate: 0.80 }).rates;
  equal(memberClearance(unit, { price: 1000 }, r), 800);
});

test('unitPrices is what a non-member sees when member is off', () => {
  const o = unitPrices(unit, { cl: null, floor: 0, member: false, rates: DEFAULT_MEMBER_RATES });
  equal(o.price, 1000);
  equal(o.clientPrice, 1000);
});

suite('member rates — stored in settings');

test('defaults with no saved value, then a save round-trips and invalid stored values are ignored', async () => {
  const { done } = await withTestDb();
  try {
    clearMemberRatesCache();
    equal((await getMemberRates()).rates, DEFAULT_MEMBER_RATES);

    const saved = await saveMemberRates({ regularRate: 0.5, minProfit: 150 });
    equal(saved.rates.regularRate, 0.5);
    equal((await getMemberRates()).rates.minProfit, 150);

    const bad = await saveMemberRates({ costFloor: 0.5 });
    assert(bad.error, 'refused');
    equal((await getMemberRates()).rates.regularRate, 0.5, 'a refused save leaves the saved rates alone');
  } finally { done(); clearMemberRatesCache(); }
});

test('overrides can be set and removed', async () => {
  const { done } = await withTestDb();
  try {
    clearMemberRatesCache();
    assert((await setOverride('SKU-1', 0)).error, 'zero is not a price');
    assert((await setOverride('', 100)).error);
    await setOverride('SKU-1', 349.5);
    equal((await getMemberRates()).overrides, { 'SKU-1': 349.5 });
    const r = await removeOverride('SKU-1');
    equal(r.removed, true);
    equal((await getMemberRates()).overrides, {});
  } finally { done(); clearMemberRatesCache(); }
});
