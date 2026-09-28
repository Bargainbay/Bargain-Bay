// lib/stock-vendors.js — whose stock is standing in the warehouse, and the
// number that clears the consignment floor.
//
// `groupRows` is pure and exported for exactly this: the tracker is a Google
// Sheet and is not in this repo, so the grouping has to be testable without it.
//
// The floor arithmetic is what this file is really for. The By vendor tab could
// say "5 units are priced under cost + 20%" and the only thing it could then
// tell anybody was to go and open the spreadsheet — a warning with no way to
// act on it. `minRetail` is the figure that makes it actionable, so it is the
// figure that has to be right.
import { suite, test, assert, equal } from './_harness.mjs';
import { groupRows } from '../lib/stock-vendors.js';
import { consignmentFloor } from '../lib/constants.js';

// A tracker row. The tracker prices a unit as Retail x Condition%, and
// `price` is that Suggested Price cell — a FORMULA, which is why the condition
// multiplier is read back off the row rather than looked up anywhere.
const row = (o = {}) => ({
  sku: 'VD-1', vendor: 'Abi', status: 'Tested Working', invoice: 'CONSIGNMENT',
  retail: 2000, price: 1200, cost: 1000, ...o
});
const only = (rows) => groupRows(rows).vendors[0].units[0];

suite('stock by vendor — the consignment floor');

test('the floor is cost + 20%, and a unit under it is flagged', () => {
  equal(consignmentFloor(1000), 1200);
  // Priced at 1100 against a floor of 1200.
  const u = only([row({ price: 1100 })]);
  equal(u.floor, 1200);
  equal(u.belowFloor, true);
});

test('AT the floor is not under it', () => {
  equal(only([row({ price: 1200 })]).belowFloor, false);
});

test('minRetail is what RETAIL must become, not what the price must become', () => {
  // Retail 2000 -> price 1100 is a 55% condition tier. To make the price 1200
  // the retail has to reach 1200 / 0.55 = 2181.81..., so 2182.
  const u = only([row({ retail: 2000, price: 1100, cost: 1000 })]);
  equal(u.floor, 1200);
  equal(u.minRetail, 2182);
  // And it genuinely clears: 2182 x 0.55 = 1200.1, which is over the floor.
  assert((u.minRetail * (1100 / 2000)) >= u.floor, 'the suggested retail clears the floor');
});

test('IT ROUNDS UP — a retail that rounds down does not clear a floor', () => {
  // 1200 / 0.5 is exactly 2400 and needs no rounding; nudge the tier so it does.
  const u = only([row({ retail: 1000, price: 700, cost: 1000 })]);
  equal(u.floor, 1200);
  // 1200 / 0.7 = 1714.28..., so 1715 and never 1714.
  equal(u.minRetail, 1715);
  assert((u.minRetail * 0.7) >= 1200, 'rounding down would leave it a cent short');
});

test('a unit that is NOT under the floor gets no suggestion', () => {
  equal(only([row({ price: 1500 })]).minRetail, null, 'null — there is nothing to fix');
});

test('an UNGRADED unit has no multiplier to work back from, and says null', () => {
  // No suggested price yet: the row is in cleaning with no Condition, which is
  // the normal state of an ungraded unit. Inventing a retail from nothing would
  // be a number somebody types into the source of truth for the business.
  const u = only([row({ price: 0 })]);
  equal(u.belowFloor, false, 'with no price there is nothing to compare');
  equal(u.minRetail, null);
});

test('a unit with no RETAIL cannot be worked back from either', () => {
  equal(only([row({ retail: 0, price: 1100 })]).minRetail, null);
});

suite('stock by vendor — only dropped-off stock has a floor at all');

test('a unit we BOUGHT has no consignment floor', () => {
  // We own it. A thin margin on our own stock is a decision, not somebody
  // else's money — the floor exists because a consigned unit is ours to sell
  // and the vendor's to be paid for.
  const u = only([row({ invoice: 'S-ORD115612', price: 100, cost: 1000 })]);
  equal(u.consigned, false);
  equal(u.floor, 0);
  equal(u.belowFloor, false);
  equal(u.minRetail, null);
});

test('a cost of zero floors nothing — a haul-away is a real answer', () => {
  const u = only([row({ cost: 0, price: 50 })]);
  equal(u.floor, 0);
  equal(u.belowFloor, false);
});

suite('stock by vendor — the count the tab leads with');

test('belowFloor counts units, per vendor and in the total', () => {
  const d = groupRows([
    row({ sku: 'A', price: 1100 }),
    row({ sku: 'B', price: 900 }),
    row({ sku: 'C', price: 1500 }),
    row({ sku: 'D', vendor: 'SecondShop', price: 100, invoice: 'S-ORD1' })
  ]);
  equal(d.totals.belowFloor, 2);
  equal(d.vendors.find((v) => v.name === 'Abi').belowFloor, 2);
  equal(d.vendors.find((v) => v.name === 'SecondShop').belowFloor, 0, 'bought stock has no floor');
});

test('vendor names fold case- and punctuation-insensitively', () => {
  const d = groupRows([row({ sku: 'A', vendor: 'Abi' }), row({ sku: 'B', vendor: 'abi ' })]);
  equal(d.vendors.length, 1, 'one company in the driveway');
  equal(d.vendors[0].onHand, 2);
});
