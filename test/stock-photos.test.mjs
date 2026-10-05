// A listed unit with no manufacturer photo shows placeholder art and is skipped
// by /feed, so it can't be advertised. Nothing used to say so: the sync reported
// success and the gap was found by looking at the shop (28 models, 2026-10-05).
import { suite, test, assert, equal } from './_harness.mjs';
import { modelsWithoutStockPhoto } from '../lib/images.js';
import { syncSummary } from '../lib/sync-report.js';
import images from '../data/images.json' with { type: 'json' };

suite('stock photo gaps');

const known = Object.keys(images)[0];

test('groups units by model and ignores models that have a photo', () => {
  const r = modelsWithoutStockPhoto([
    { id: 'A-1', model: 'NOPE-1', make: 'LG' },
    { id: 'A-2', model: 'NOPE-1', make: 'LG' },
    { id: 'A-3', model: known },
    { id: 'A-4', model: 'NOPE-2' },
  ]);
  equal(r.length, 2);
  equal(r[0].model, 'NOPE-1');
  equal(r[0].skus.length, 2);
});

test('an explicit image override counts as having a photo', () => {
  equal(modelsWithoutStockPhoto([{ id: 'B-1', model: 'NOPE-3', image: 'https://x/y.jpg' }]).length, 0);
});

test('a unit with no model is still reported, per unit', () => {
  const r = modelsWithoutStockPhoto([{ id: 'C-1' }, { id: 'C-2', model: '' }]);
  equal(r.length, 2);
});

test('the sync summary warns when models lack a photo, and is quiet otherwise', () => {
  const warn = syncSummary({ report: { noStockPhoto: [{ model: 'NOPE-1', skus: ['A-1', 'A-2'] }] } }).warnings;
  assert(warn.some((w) => w.includes('NOPE-1') && w.includes('2 units')));
  equal(syncSummary({ report: { noStockPhoto: [] } }).warnings.length, 0);
});

test('every images.json entry is an https URL', () => {
  for (const [k, v] of Object.entries(images)) assert(/^https:\/\//.test(v), `${k} is not an https URL`);
});
