import { suite, test, assert, equal } from './_harness.mjs';
import { offerFloor, offerProblem } from '../lib/member-offer-rules.js';

suite('member offers: rules');
test('floor is the highest of cost, member floor, consignment floor', () => {
  equal(offerFloor({ cost: 100, memberFloor: 300, consignFloor: 120 }), 300);
  equal(offerFloor({ cost: 400, memberFloor: 300 }), 400);
  equal(offerFloor({}), 0);
});
test('offer must be under the member price and at/over the floor', () => {
  assert(offerProblem({ amount: 0, memberPrice: 500, floor: 300 }));
  assert(offerProblem({ amount: 500, memberPrice: 500, floor: 300 }), 'at price is refused');
  assert(offerProblem({ amount: 299.99, memberPrice: 500, floor: 300 }), 'under floor is refused');
  equal(offerProblem({ amount: 300, memberPrice: 500, floor: 300 }), '');
  assert(offerProblem({ amount: 'abc', memberPrice: 500, floor: 300 }));
});

import { publicOfferFloor, holdHoursFor } from '../lib/member-offer-rules.js';
suite('public offers: rules');
test('public floor is cost + 25%, rounded up, or the consignment floor', () => {
  equal(publicOfferFloor({ cost: 400 }), 500);
  equal(publicOfferFloor({ cost: 379.35 }), 475);
  equal(publicOfferFloor({ cost: 400, consignFloor: 520 }), 520);
  equal(publicOfferFloor({ cost: 0 }), 0);
});
test('hold length by kind', () => { equal(holdHoursFor('public'), 4); equal(holdHoursFor('member'), 4); });

import { hasOfferRoom } from '../lib/member-offer-rules.js';
suite('offers: which units are open');
test('room must be at least $40 and 8% of the price', () => {
  assert(hasOfferRoom({ price: 800, floor: 500 }), '$300 room on $800');
  assert(!hasOfferRoom({ price: 800, floor: 760 }), '$40 room is under 8% of $800');
  assert(!hasOfferRoom({ price: 300, floor: 275 }), 'under $40');
  assert(hasOfferRoom({ price: 300, floor: 250 }), '$50 room, >8%');
  assert(!hasOfferRoom({ price: 0, floor: 0 }));
});

suite('offers: refurbished units');
test('a refurbished unit opens on a lower bar, and still needs some room', () => {
  assert(!hasOfferRoom({ price: 800, floor: 760 }), 'regular: $40 on $800 is under 8%');
  assert(hasOfferRoom({ price: 800, floor: 740, refurbished: true }), 'refurbished: $60 clears max($20, 3%)');
  assert(!hasOfferRoom({ price: 800, floor: 790, refurbished: true }), 'refurbished with $10 of room stays closed');
  assert(!hasOfferRoom({ price: 500, floor: 600, refurbished: true }), 'floor above the price is never open');
});
