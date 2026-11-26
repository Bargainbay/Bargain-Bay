import { suite, test, equal, assert } from './_harness.mjs';
import { parseTrackerCsv } from '../lib/csv.js';
import { CONDITIONS, INTAKE_CONDITIONS } from '../lib/constants.js';
import { LISTING_CONDITIONS } from '../lib/listing-rules.js';
import { conditionCopy, warrantyPhrase } from '../lib/specs.js';
import { inSale } from '../lib/bf-hero.js';
import { applyClearance } from '../lib/clearance.js';
import { wrapLikeNewFormula, unwrapLikeNewFormula } from '../lib/like-new-formula.js';

suite('Like New — flat 60% of retail, one-year warranty, ours only');

const HEAD = 'Item ID / SKU,Make,Model,Description,Retail Price,Condition,Condition %,Suggested Sale Price,Status,Vendor';
const row = (id, cond, retail, pct, ask, vendor = 'SecondShop') =>
  `${id},LG,M1,Fridge,${retail},${cond},${pct},${ask},Tested Working,${vendor}`;
const priceOf = (line) => parseTrackerCsv([HEAD, line].join('\n')).units[0];

test('60% of retail over $1,000 and under it', () => {
  equal(priceOf(row('A', 'Like New', 1849.99, '60%', 1109.99)).price, 1109.99);
  equal(priceOf(row('B', 'Like New', 799.99, '60%', 530)).price, 479.99);
});

test('60% even when the sheet tier is blank or says something else', () => {
  equal(priceOf(row('A', 'Like New', 2000, '', '')).price, 1200);
  equal(priceOf(row('B', 'like new', 900, '70%', 630)).price, 540);
});

test('the label is normalised, and an Abi row follows the same 60%', () => {
  equal(priceOf(row('A', 'like-new', 1000, '60%', 600)).condition, 'Like New');
  equal(priceOf(row('B', 'Like New', 1000, '60%', 600, 'Abi')).price, 600);
});

test('Refurbished is unchanged', () => {
  const u = priceOf(row('A', 'Refurbished', 2000, '50%', 1000));
  equal(u.condition, 'Refurbished');
  equal(u.price, 1000);
});

test('it has its explainer, and keeps the one-year warranty', () => {
  assert(/signs of use/i.test(CONDITIONS['Like New']));
  assert(/signs of use/i.test(conditionCopy('Like New')) && /certified tested/i.test(conditionCopy('Like New')));
  const cleared = applyClearance({ id: 'A', condition: 'Like New', price: 600 }, { price: 500, warrantyMonths: 12 });
  equal(cleared.warrantyMonths, 12);
  equal(warrantyPhrase(cleared.warrantyMonths), 'one-year warranty');
});

test('staff can pick it; marketplace sellers cannot; Black Friday leaves it out', () => {
  assert(INTAKE_CONDITIONS.includes('Like New'));
  assert(!LISTING_CONDITIONS.includes('Like New'));
  assert(!inSale({ condition: 'Like New' }));
});

test('the sheet formula wrapper is idempotent and undoes exactly', () => {
  const o = { condCell: 'L9', retailCell: 'K9', pctCell: 'M9' };
  const f = '=IF(K9<Settings!$E$13,MIN(MAX(K9*M9,N(W9)+Settings!$E$14),K9*Settings!$E$15),K9*M9)';
  const w = wrapLikeNewFormula(f, o);
  assert(w.startsWith('=IF(AND(LOWER(TRIM(L9))="like new"'));
  equal(wrapLikeNewFormula(w, o), w);
  equal(unwrapLikeNewFormula(w, o), f);
  equal(unwrapLikeNewFormula(f, o), null);
  equal(wrapLikeNewFormula('499', o), null);
});
