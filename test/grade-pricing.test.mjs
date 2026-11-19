import { suite, test, equal } from './_harness.mjs';
import { applyGradePricing, bumpedPrice } from '../lib/grade-pricing.js';

suite('lib/grade-pricing — GA/GB New Scratch & Dent list 5 points higher');

const sd = (id, retail, pct) => ({ id, condition: 'New Scratch & Dent', compareAt: retail, price: retail * pct });

test('standard tier: 60% -> 65% of retail for GA and GB', () => {
  equal(bumpedPrice(sd('A', 2000, 0.6), 'GA'), 1300);
  equal(bumpedPrice(sd('A', 2000, 0.6), 'gb'), 1300);
});

test('under-$1000 tier: 70% -> 75% of retail', () => {
  equal(bumpedPrice(sd('A', 800, 0.7), 'GB'), 600);
});

test('GC, GD, other grades and no grade stay where they were', () => {
  equal(bumpedPrice(sd('A', 2000, 0.6), 'GC'), 1200);
  equal(bumpedPrice(sd('A', 2000, 0.6), 'GD'), 1200);
  equal(bumpedPrice(sd('A', 2000, 0.6), 'A'), 1200);
  equal(bumpedPrice(sd('A', 2000, 0.6), ''), 1200);
});

test('only New Scratch & Dent moves', () => {
  const u = { id: 'A', condition: 'Refurbished', compareAt: 1000, price: 500 };
  equal(bumpedPrice(u, 'GA'), 500);
  equal(bumpedPrice({ ...u, condition: 'New Open Box', price: 700 }, 'GA'), 700);
});

test('no retail means no guess; never above retail', () => {
  equal(bumpedPrice({ condition: 'New Scratch & Dent', compareAt: 0, price: 500 }, 'GA'), 500);
  equal(bumpedPrice({ condition: 'New Scratch & Dent', compareAt: 1000, price: 980 }, 'GA'), 1000);
});

test('applied across a list by SKU, case-insensitively, and counted', () => {
  const units = [sd('SS-1', 2000, 0.6), sd('SS-2', 2000, 0.6), sd('SS-3', 2000, 0.6)];
  const r = applyGradePricing(units, { 'ss-1': 'GA', 'SS-2': 'GD' });
  equal(r.units[0].price, 1300);
  equal(r.units[1].price, 1200);
  equal(r.units[2].price, 1200);
  equal(r.bumped, 1);
});

import { wrapGradeFormula, unwrapGradeFormula } from '../lib/grade-formula.js';

suite('lib/grade-formula — the sheet formula can be put on and taken off exactly');

const opts = { condCell: 'H12', retailCell: 'K12', skuCell: 'B12' };

test('wrap then unwrap returns the original formula character for character', () => {
  const orig = '=IFERROR(K12*M12,"")';
  const w = wrapGradeFormula(orig, opts);
  equal(w.startsWith('=IF(AND(ISNUMBER(SEARCH("scratch",H12))'), true);
  equal(unwrapGradeFormula(w, opts), orig);
});

test('wrapping twice changes nothing, and a typed value is left alone', () => {
  const w = wrapGradeFormula('=K12*M12', opts);
  equal(wrapGradeFormula(w, opts), w);
  equal(wrapGradeFormula('899', opts), null);
  equal(unwrapGradeFormula('=K12*M12', opts), null);
});

test('the sheet bump stays under the tracker ask cap on the under-$1000 tier', () => {
  const w = wrapGradeFormula('=K12*M12', opts);
  equal(w.includes('K12*Settings!$E$15'), true);
  equal(unwrapGradeFormula(w, opts), '=K12*M12');
});
