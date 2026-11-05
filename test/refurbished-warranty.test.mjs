// A Refurbished unit carries a 3-month warranty; every other condition keeps its own.
import { suite, test, equal } from './_harness.mjs';
import { applyClearance } from '../lib/clearance.js';
import { REFURBISHED_WARRANTY_MONTHS } from '../lib/constants.js';

suite('refurbished warranty');

test('the constant is 3 months', () => equal(REFURBISHED_WARRANTY_MONTHS, 3));

test('a refurbished unit on clearance gets 3 months even when the row says 12', () => {
  equal(applyClearance({ id: 'A', condition: 'Refurbished', price: 100 }, { price: 80, warrantyMonths: 12 }).warrantyMonths, 3);
});

test("another condition on clearance keeps the clearance row's warranty", () => {
  equal(applyClearance({ id: 'B', condition: 'New Open Box', price: 100 }, { price: 80, warrantyMonths: 12 }).warrantyMonths, 12);
});
