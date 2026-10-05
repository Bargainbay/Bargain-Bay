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

// ---- the editable layer (model_photos) ----
import { withTestDb } from './db.mjs';
import { setModelPhoto, clearModelPhoto, modelPhotoRows, validPhotoUrl } from '../lib/model-photos.js';
import { modelImage } from '../lib/images.js';

suite('stock photos — managed from /admin/photos');

test('only full https links are accepted', () => {
  assert(validPhotoUrl('https://x.com/a.jpg'));
  equal(validPhotoUrl('http://x.com/a.jpg'), null);
  equal(validPhotoUrl('javascript:alert(1)'), null);
  equal(validPhotoUrl('/stock/range.svg'), null);
  equal(validPhotoUrl('https://x.com/a b.jpg'), null);
});

test('a row wins over images.json, and removing it falls back', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(
      `INSERT INTO products (sku, make, model, category, title, price, active) VALUES ('T-1','LG','NEWMODEL-1','Range','t',100,true),('T-2','LG',$1,'Range','t',100,true)`, [known]);
    let rows = await modelPhotoRows();
    equal(rows[0].model, 'NEWMODEL-1');
    equal(rows[0].source, 'missing');
    await setModelPhoto('NEWMODEL-1', { url: 'https://cdn.example/new.jpg' }, { createdBy: 'a@b.c' });
    equal(modelImage('NEWMODEL-1'), 'https://cdn.example/new.jpg');
    // overriding a model that is in the file replaces it; clearing restores it
    await setModelPhoto(known, { url: 'https://cdn.example/over.jpg' });
    equal(modelImage(known), 'https://cdn.example/over.jpg');
    await clearModelPhoto(known);
    assert(modelImage(known) && modelImage(known) !== 'https://cdn.example/over.jpg');
    await clearModelPhoto('NEWMODEL-1');
    equal(modelImage('NEWMODEL-1'), null);
    rows = await modelPhotoRows();
    equal(rows.find((r) => r.model === 'NEWMODEL-1').source, 'missing');
  } finally { done(); }
});
