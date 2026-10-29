import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCategory, canonicalizeUnits } from '../lib/category.js';
import { COLLECTIONS } from '../lib/constants.js';

const inCollection = (slug, cat) => COLLECTIONS.find((c) => c.slug === slug).cats.includes(cat);

test('spellings land on the collection spelling', () => {
  assert.equal(canonicalCategory('Laundry Centre'), 'Laundry Center');
  assert.equal(canonicalCategory('Washer Dryer Combo'), 'Washer/Dryer Combo');
  assert.equal(canonicalCategory('All in One'), 'Washer/Dryer Combo');
  assert.equal(canonicalCategory('Pedestal'), 'Laundry Pedestal');
  assert.equal(canonicalCategory('Carpet Cleaner'), 'Vacuum');
  assert.ok(inCollection('washers-dryers', canonicalCategory('Laundry Centre')));
});

test('a vague category is read from the title', () => {
  assert.equal(canonicalCategory('Appliance', { title: 'Whirlpool 36" French Door Fridge' }), 'Refrigerator');
  assert.equal(canonicalCategory('Other', { title: 'Marathon 15 Inch Dual Zone Wine Cooler' }), 'Wine Cooler');
  assert.equal(canonicalCategory('Appliance', { title: 'Electrolux 15 Inch Laundry Pedestal' }), 'Laundry Pedestal');
  assert.equal(canonicalCategory('Appliance', { title: 'ELECTROLUX EPWD257UTT' }), 'Appliance');
});

test('nothing to go on stays as it was; a combo is not a washer; a hood is not a range', () => {
  assert.equal(canonicalCategory('Other', { title: 'Pairing Kit' }), 'Other');
  assert.equal(canonicalCategory('Appliance', { title: 'Midea All-in-One Washer Dryer Combo' }), 'Washer/Dryer Combo');
  assert.equal(canonicalCategory('Appliance', { title: 'GE Range Hood' }), 'Range Hood');
});

test('a still-vague unit borrows its category from the same model', () => {
  const out = canonicalizeUnits([
    { id: 'a', model: 'EPWD257UTT', category: 'Pedestal', title: 'x' },
    { id: 'b', model: 'EPWD257UTT', category: 'Appliance', title: 'ELECTROLUX EPWD257UTT' },
    { id: 'c', model: 'ZZ1', category: 'Appliance', title: 'nothing' }
  ]);
  assert.equal(out[1].category, 'Laundry Pedestal');
  assert.equal(out[2].category, 'Appliance');
});

test('a model with conflicting categories is not guessed', () => {
  const out = canonicalizeUnits([
    { id: 'a', model: 'M1', category: 'Washer', title: '' },
    { id: 'b', model: 'M1', category: 'Dryer', title: '' },
    { id: 'c', model: 'M1', category: 'Appliance', title: '' }
  ]);
  assert.equal(out[2].category, 'Appliance');
});

test('accessories are not the appliance they fit; model families cover bare titles', () => {
  assert.equal(canonicalCategory('Other', { title: 'Frigidaire Single-Door Freezer and Refrigerator Pairing Kit' }), 'Other');
  assert.equal(canonicalCategory('Appliance', { title: 'Whirlpool', model: 'WRFF3136SZ' }), 'Refrigerator');
  assert.equal(canonicalCategory('Appliance', { title: 'LG LF21C6200S', model: 'LF21G6200S' }), 'Refrigerator');
  assert.equal(canonicalCategory('Appliance', { title: 'x', model: 'ZZ9' }), 'Appliance');
});
