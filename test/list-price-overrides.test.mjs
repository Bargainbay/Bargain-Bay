import { suite, test, equal, assert } from './_harness.mjs';
import { applyOverrides, cleanOverrides } from '../lib/list-price-overrides.js';

suite('lib/list-price-overrides — a typed list price beats the sheet');

test('the typed price replaces the sheet price and the tracker price is remembered', () => {
  const units = [{ id: 'A', price: 847.5 }, { id: 'B', price: 100 }];
  const r = applyOverrides(units, { A: { price: 999, tracker: 847.5 } });
  equal(r.units[0].price, 999);
  equal(r.units[1].price, 100, 'other units untouched');
  equal(r.changed, false);
});

test('when the sheet price moves, the stored tracker price follows but the typed price still wins', () => {
  const r = applyOverrides([{ id: 'A', price: 900 }], { A: { price: 999, tracker: 847.5 } });
  equal(r.units[0].price, 999);
  equal(r.overrides.A.tracker, 900);
  assert(r.changed);
});

test('rubbish in the settings value is ignored', () => {
  const c = cleanOverrides({ A: { price: 999, tracker: 800 }, B: { price: 0, tracker: 5 }, C: 'x', '': { price: 1, tracker: 1 } });
  equal(Object.keys(c).join(), 'A');
});
