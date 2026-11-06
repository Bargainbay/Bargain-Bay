// The sales floor's photo list: a unit is on it until the product page has a
// picture of the actual machine — ours, or RS Ops's inspection set.
import { suite, test, equal, assert } from './_harness.mjs';
import { photoQueue, hasRealPhotos } from '../lib/photo-queue.js';

suite('photo queue');

test('a unit with no photos of its own or from RS Ops is on the list', () => {
  const r = photoQueue([{ id: 'A-1' }, { id: 'A-2', photos: [] }, { id: 'A-3', rsopsPhotos: [] }]);
  equal(r.todo.map((u) => u.id), ['A-1', 'A-2', 'A-3']);
  equal(r.withPhotos, 0);
});

test('our photos or RS Ops photos each take a unit off the list', () => {
  const r = photoQueue([
    { id: 'B-1', photos: [{ url: '/api/photo/B-1-1' }] },
    { id: 'B-2', rsopsPhotos: [{ url: 'x' }] },
    { id: 'B-3' },
  ]);
  equal(r.todo.map((u) => u.id), ['B-3']);
  equal(r.withPhotos, 2);
  equal(r.total, 3);
});

test('the stock picture alone does not count as a photo of the unit', () => {
  equal(hasRealPhotos({ id: 'C-1', image: '/model-photos/X.jpg' }), false);
});

test('nothing in, nothing to do', () => {
  const r = photoQueue(null);
  equal(r.total, 0); equal(r.todo.length, 0);
});

// ---- choosing the unit -------------------------------------------------------
// 2026-11-04: Roushi typed the MODEL number into the SKU box. The photos saved,
// loaded, and belonged to nothing. The route now refuses anything that is not a unit.
import { withTestDb } from './db.mjs';
import { findUnits, resolveUnitSku } from '../lib/photo-queue.js';
import { ensureUnitPhotoSchema } from '../lib/unit-photos.js';

suite('photo queue — the unit is chosen, not typed');

async function seeded() {
  const t = await withTestDb();
  await t.client.query(`INSERT INTO products (sku, make, model, category, title, condition, active) VALUES
    ('SS-117082-022', 'Frigidaire', 'PRFS2883AF', 'Refrigerator', 'Frigidaire Professional 36 Inch French Door', 'New Scratch & Dent', true),
    ('SS-117082-023', 'Frigidaire', 'PRFS2883AF', 'Refrigerator', 'Frigidaire Professional 36 Inch French Door', 'New Scratch & Dent', true),
    ('VD-ABC', 'LG', 'LREN6321YE', 'Range', 'LG Range', 'New Open Box', true),
    ('SOLD-1', 'LG', 'GONE1', 'Range', 'LG Gone', 'Refurbished', false),
    ('HELD-1', 'Whirlpool', 'WRF535', 'Refrigerator', 'Whirlpool On Hold', 'Refurbished', true)`);
  // HELD-1 has a live checkout hold on it: still active, no longer available.
  await t.client.query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('HELD-1', 1, now() + interval '20 minutes')`);
  return t;
}

test('a real SKU is accepted and comes back spelled the way the products table spells it', async () => {
  const t = await seeded();
  try {
    equal(await resolveUnitSku('SS-117082-022'), { sku: 'SS-117082-022' });
    equal(await resolveUnitSku('  ss-117082-022 '), { sku: 'SS-117082-022' });
  } finally { t.done(); }
});

test('a MODEL number is refused and the units of that model are named', async () => {
  const t = await seeded();
  try {
    const r = await resolveUnitSku('prfs2883af');
    assert(r.error && !r.sku, 'must not resolve');
    assert(r.error.includes('model number') && r.error.includes('SS-117082-022') && r.error.includes('SS-117082-023'), r.error);
  } finally { t.done(); }
});

test('an unknown SKU and a blank are refused with something to do about it', async () => {
  const t = await seeded();
  try {
    assert((await resolveUnitSku('NOPE-1')).error.includes('Pick one'));
    assert((await resolveUnitSku('   ')).error.includes('Choose the unit'));
  } finally { t.done(); }
});

test('typing finds units by any words in brand, model, title or SKU, and says how many photos each has', async () => {
  const t = await seeded();
  try {
    await ensureUnitPhotoSchema();
    await t.client.query(`INSERT INTO unit_photos (sku, path, url, position) VALUES ('SS-117082-022','p','/api/photo/SS-117082-022-1',0)`);
    const r = await findUnits('frigidaire 2883');
    equal(r.map((u) => u.sku), ['SS-117082-022', 'SS-117082-023']);
    equal(r.map((u) => u.photos), [1, 0]);
    equal((await findUnits('ss-117082-022'))[0].sku, 'SS-117082-022');
    equal(await findUnits('GONE1'), []);          // off the site: not offered
    equal(await findUnits('x'.repeat(3) + ' nothing'), []);
    equal(await findUnits('100%_'), []);          // wildcards typed by a person are literal
  } finally { t.done(); }
});

test('a unit that is sold, off the site, or on hold is neither offered nor accepted', async () => {
  const t = await seeded();
  try {
    equal(await findUnits('whirlpool'), []);          // held: not offered
    equal(await findUnits('GONE1'), []);              // off the site: not offered
    const held = await resolveUnitSku('HELD-1');
    assert(held.error && held.error.includes('not on the available inventory list'), held.error);
    const gone = await resolveUnitSku('SOLD-1');
    assert(gone.error && !gone.sku, 'an inactive unit must not resolve');
    equal(await resolveUnitSku('VD-ABC'), { sku: 'VD-ABC' });   // an available one still does
  } finally { t.done(); }
});

test('a hold on one unit of a model does not hide the free ones, or the model-number help', async () => {
  const t = await seeded();
  try {
    await t.client.query(`INSERT INTO reservations (sku, order_id, expires_at) VALUES ('SS-117082-022', 2, now() + interval '20 minutes')`);
    equal((await findUnits('PRFS2883AF')).map((u) => u.sku), ['SS-117082-023']);
    const r = await resolveUnitSku('PRFS2883AF');
    assert(r.error.includes('SS-117082-023') && !r.error.includes('SS-117082-022'), r.error);
  } finally { t.done(); }
});
