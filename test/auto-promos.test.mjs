// lib/coupons autoDiscountFor: an automatic promotion must never be the reason
// something sells at a loss. Tiers are checked against real tracker figures
// (2026-10-08): WRT541SZDZ priced $987 against a $790.25 cost loses money at 20%.
import { suite, test, equal, assert } from './_harness.mjs';
import { autoDiscountFor } from '../lib/coupons.js';
import { upliftedPrice, vendorUpliftPct } from '../lib/constants.js';
import { parseTrackerCsv } from '../lib/csv.js';
import { wrapPriceFormula, unwrapPriceFormula, isWrapped } from '../lib/vendor-formula.js';

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

suite('lib/constants: a vendor uplift lifts the public price');

test('Abi units are +20% (the 10% rule plus a further 10%), however the vendor name is spelled', () => {
  equal(vendorUpliftPct('Abi'), 20);
  equal(vendorUpliftPct(' ABI '), 20);
  equal(vendorUpliftPct('SecondShop'), 0);
  equal(vendorUpliftPct(null), 0);
});

test('the uplift is applied to the tracker price', () => {
  equal(upliftedPrice(1860, 2595, 'Abi'), 2232);
});

test('another vendor, or no vendor, is untouched', () => {
  equal(upliftedPrice(1860, 2595, 'SecondShop'), 1860);
  equal(upliftedPrice(1860, 2595, null), 1860);
});

test('it never goes past retail, and never below the price it started at', () => {
  equal(upliftedPrice(1000, 1050, 'Abi'), 1050);
  equal(upliftedPrice(1100, 1000, 'Abi'), 1320);   // retail below price: no cap to hold it to
  equal(upliftedPrice(0, 500, 'Abi'), 0);
});

suite('lib/csv: the tracker read applies the vendor uplift once');

const HEAD = 'Lot Number,Item ID / SKU,Category,Make,Model,Description,Serial Number,Vendor / Supplier,Retail Price,Condition,Condition %,Suggested Sale Price,Status,Total Cost';
const row = (sku, vendor) => `L1,${sku},Laundry,LG,WKEX200HBA,LG tower,123,${vendor},2000,New Open Box,80%,1600,Tested Working,1000`;

test("an Abi row is priced 20% over Retail x Condition %, and everyone else's is not", () => {
  const { units } = parseTrackerCsv([HEAD, row('VD-1', 'Abi'), row('SS-1', 'SecondShop'), row('X-1', '')].join('\n'));
  const price = (id) => units.find((u) => u.id === id).price;
  equal(price('VD-1'), 1920);
  equal(price('SS-1'), 1600);
  equal(price('X-1'), 1600);
});

test('the strike-through retail is never touched', () => {
  const { units } = parseTrackerCsv([HEAD, row('VD-1', 'Abi')].join('\n'));
  equal(units[0].compareAt, 2000);
});

suite('lib/coupons: a typed code may not take a vendor unit under its floor');

test('a 10% referral code on a unit that cannot spare it gives only what it can', () => {
  // priced 1860, floor 1860: nothing to give. Our own unit beside it gives the full 10%.
  const r = autoDiscountFor(pct(10), [unit(1860, 1860), unit(1000, 0)]);
  equal(r.discount, 100);
  assert(r.capped, 'capped on the vendor unit');
});

suite('lib/vendor-formula: the sheet formula wraps, and unwraps exactly');

const OPT = { vendorCell: 'H854', factor: '1.2' };

test('it wraps the existing formula and the vendor test reads this row', () => {
  const w = wrapPriceFormula('=ROUND(K854*M854,2)', OPT);
  equal(w, '=IF(LOWER(TRIM(H854))="abi",ROUND((ROUND(K854*M854,2))*1.2,2),ROUND(K854*M854,2))');
});

test('unwrapping gives back the original, character for character', () => {
  for (const f of ['=ROUND(K854*M854,2)', '=IFERROR(K854*M854,"")', '=IF(M854="","",K854*M854)']) {
    equal(unwrapPriceFormula(wrapPriceFormula(f, OPT)), f);
  }
});

test('wrapping twice changes nothing', () => {
  const once = wrapPriceFormula('=K854*M854', OPT);
  equal(wrapPriceFormula(once, OPT), once);
  assert(isWrapped(once));
});

test('a typed value is a deliberate override: never wrapped', () => {
  equal(wrapPriceFormula('1996', OPT), null);
  equal(unwrapPriceFormula('=K854*M854'), null);
});
