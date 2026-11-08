// Delivery priced by distance from Pickering (lib/delivery-zones.js, lib/delivery-fee.js).
// What must hold: the rate-sheet zones and their edges, the owner's catalog overrides, an
// unknown distance is Zone A AND flagged (never an invented distance), seller shipments stay flat.
import { suite, test, assert, equal } from './_harness.mjs';
import { deliveryFeeForKm, deliveryTotal, freeDeliveryApplies, DELIVERY_ZONES } from '../lib/delivery-zones.js';

suite('delivery zones — the rate sheet');

test('zones and their edges: 50 is Zone A, 50.1 is Zone B, 150 is Zone C', () => {
  equal(deliveryFeeForKm(0).fee, 95); equal(deliveryFeeForKm(50).fee, 95); equal(deliveryFeeForKm(50).zone, 'A');
  equal(deliveryFeeForKm(50.1).fee, 140); equal(deliveryFeeForKm(100).fee, 140);
  equal(deliveryFeeForKm(100.1).fee, 225); equal(deliveryFeeForKm(150).fee, 225); equal(deliveryFeeForKm(150).zone, 'C');
  equal(deliveryFeeForKm(68.4).verified, true);
});

test('past 150 km: Zone C plus $2 for each km begun beyond it', () => {
  equal(deliveryFeeForKm(150.1).fee, 227);
  equal(deliveryFeeForKm(180).fee, 285);
  equal(deliveryFeeForKm(180).zone, 'beyond');
});

test('an unknown distance is Zone A and FLAGGED, never a guessed zone', () => {
  for (const km of [null, undefined, '', NaN, -5, 'far']) {
    const r = deliveryFeeForKm(km);
    equal(r.fee, 95); equal(r.verified, false); equal(r.km, null);
  }
});

test('the owner\'s catalog price wins; a blank price or a switched-off zone keeps the sheet', () => {
  const o = { 'Delivery – Zone B': { price: 150, active: true } };
  equal(deliveryFeeForKm(70, o).fee, 150);
  equal(deliveryFeeForKm(30, o).fee, 95, 'other zones untouched');
  equal(deliveryFeeForKm(70, { 'Delivery – Zone B': { price: null, active: true } }).fee, 140);
  equal(deliveryFeeForKm(70, { 'Delivery – Zone B': { price: 999, active: false } }).fee, 999, 'a price is a price; "off" does not make delivery free');
  equal(deliveryFeeForKm(120, { 'Delivery – Zone C': { price: 250, active: true } }).fee, 250);
  equal(deliveryFeeForKm(160, { 'Delivery – Zone C': { price: 250, active: true } }).fee, 270, 'the per-km charge rides on the catalog Zone C price');
});

suite('delivery zones — shipments');

const ours = { id: 'A1' };
const seller = (id) => ({ id: `MP-${id}`, marketplace: true, lane: 'C', vendor: { id } });
test('our shipment is priced by distance; each self-shipping seller stays the flat fee', () => {
  equal(deliveryTotal([ours, { id: 'A2' }], 140, 79).total, 140, 'two of ours are one shipment');
  equal(deliveryTotal([ours, seller(1)], 140, 79).total, 219);
  equal(deliveryTotal([seller(1), seller(2), seller(1)], 140, 79).total, 158, 'seller-only cart is not charged our zone fee');
  equal(deliveryTotal([ours], 95, 79).shipments, 1);
});

test('the three zones are the owner\'s starting-list names', () => {
  equal(DELIVERY_ZONES.map((z) => z.name), ['Delivery – Zone A', 'Delivery – Zone B', 'Delivery – Zone C']);
});

suite('delivery zones — free over $5,000');

test('free local delivery: strictly over $5,000, never past 150 km, our shipment only', () => {
  const q = (km) => deliveryFeeForKm(km);
  equal(freeDeliveryApplies(5000, q(30)), false, 'exactly $5,000 is not over');
  equal(freeDeliveryApplies(5000.01, q(30)), true);
  equal(freeDeliveryApplies(6000, q(140)), true, 'Zone C is local');
  equal(freeDeliveryApplies(6000, q(170)), false, 'past 150 km is not local');
  equal(freeDeliveryApplies(6000, q(null)), true, 'an unmeasured address is flagged elsewhere, not charged more');
  equal(deliveryTotal([ours], 140, 79, { free: true }).total, 0);
  equal(deliveryTotal([ours, seller(1)], 140, 79, { free: true }).total, 79, 'the seller ships their own');
});
