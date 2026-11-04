// lib/coupons autoDiscountFor: an automatic promotion must never be the reason
// something sells at a loss. Tiers are checked against real tracker figures
// (2026-10-08): WRT541SZDZ priced $987 against a $790.25 cost loses money at 20%.
import { suite, test, equal, assert } from './_harness.mjs';
import { autoDiscountFor } from '../lib/coupons.js';
import { vendorListPrice, vendorListRule } from '../lib/constants.js';
import { parseTrackerCsv } from '../lib/csv.js';
import { wrapListFormula, unwrapListFormula, wrapPriceFormula, unwrapPriceFormula, isWrapped } from '../lib/vendor-formula.js';

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

suite('lib/constants: Abi is listed at a share of retail by condition');

test('the rule applies to Abi however the name is spelled, and to nobody else', () => {
  equal(vendorListRule('Abi')['New Open Box'], 85);
  equal(vendorListRule(' ABI ')['Refurbished'], 60);
  equal(vendorListRule('SecondShop'), null);
  equal(vendorListRule(null), null);
});

test('New Open Box and Scratch & Dent are 85% of retail, whatever the tracker price says', () => {
  equal(vendorListPrice(899.10, 999, 'Abi', 'New Open Box'), 849.15);
  equal(vendorListPrice(850.50, 945, 'Abi', 'New Scratch & Dent'), 803.25);
  equal(vendorListPrice(1, 999, 'Abi', 'New Open Box'), 849.15);
});

test('it can never exceed retail, and a blank retail leaves the tracker price alone', () => {
  equal(vendorListPrice(899.10, 0, 'Abi', 'New Open Box'), 899.10);
  equal(vendorListPrice(0, 0, 'Abi', 'New Open Box'), 0);
});

test('New in Box is 90% and Refurbished 60%; other vendors and unnamed conditions are untouched', () => {
  equal(vendorListPrice(700, 999, 'Abi', 'New in Box'), 899.10);
  equal(vendorListPrice(700, 999, 'Abi', 'Refurbished'), 599.40);
  equal(vendorListPrice(700, 999, 'Abi', 'Tested & Working'), 700);
  equal(vendorListPrice(1860, 2595, 'SecondShop', 'New Open Box'), 1860);
  equal(vendorListPrice(1860, 2595, null, 'New Open Box'), 1860);
});

suite('lib/csv: the tracker read prices Abi off retail, once');

const HEAD = 'Lot Number,Item ID / SKU,Category,Make,Model,Description,Serial Number,Vendor / Supplier,Retail Price,Condition,Condition %,Suggested Sale Price,Status,Total Cost';
const row = (sku, vendor, cond = 'New Open Box', retail = 2000) => `L1,${sku},Laundry,LG,WKEX200HBA,LG tower,123,${vendor},${retail},${cond},80%,1600,Tested Working,1300`;

test("an Abi open-box row is 85% of retail, and everyone else's is Retail x Condition %", () => {
  const { units } = parseTrackerCsv([HEAD, row('VD-1', 'Abi'), row('SS-1', 'SecondShop'), row('X-1', '')].join('\n'));
  const price = (id) => units.find((u) => u.id === id).price;
  equal(price('VD-1'), 1700);
  equal(price('SS-1'), 1600);
  equal(price('X-1'), 1600);
});

test('an Abi refurbished row is 60% of retail, a New in Box row 90%', () => {
  const { units } = parseTrackerCsv([HEAD, row('VD-2', 'Abi', 'Refurbished'), row('VD-3', 'Abi', 'New in Box')].join('\n'));
  equal(units[0].price, 1200);
  equal(units[1].price, 1800);
});

test('a price above retail is reported by the read', () => {
  const { report } = parseTrackerCsv([HEAD, row('SS-9', 'SecondShop', 'New Open Box', 1500).replace('80%', '110%')].join('\n'));
  equal(report.aboveRetail.length, 1);
  equal(report.aboveRetail[0].id, 'SS-9');
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

suite('lib/vendor-formula: the retail-percentage rule wraps, and unwraps exactly');

const LOPT = { vendorCell: 'H854', retailCell: 'K854', condCell: 'J854', rates: { nib: 90, nob: 85, refurb: 60 } };

test('it wraps the original and gives it back character for character', () => {
  for (const f of ['=ROUND(K854*M854,2)', '=IFERROR(K854*M854,"")', '=IF(M854="","",K854*M854)']) {
    const w = wrapListFormula(f, LOPT);
    assert(w.includes('"abi"') && w.includes('/100'), 'carries the rule');
    equal(unwrapListFormula(w, LOPT), f);
    equal(wrapListFormula(w, LOPT), w);       // idempotent
  }
});

test('a cell still wrapped with the old x1.2 uplift is unwrapped first', () => {
  const old = wrapPriceFormula('=ROUND(K854*M854,2)', { vendorCell: 'H854', factor: '1.2' });
  equal(unwrapListFormula(wrapListFormula(old, LOPT), LOPT), '=ROUND(K854*M854,2)');
});

test('a typed value is never wrapped', () => {
  equal(wrapListFormula('1078.92', LOPT), null);
});
