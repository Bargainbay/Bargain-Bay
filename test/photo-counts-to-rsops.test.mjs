// Photos saved on Bargain Bay are reported to RS Ops as a count per unit, 0 included.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { ensureUnitPhotoSchema, photoCounts, deleteUnitPhoto } from '../lib/unit-photos.js';

suite('photo counts to RS Ops');

test('counts per SKU; a SKU asked about with no photos reports 0', async () => {
  const t = await withTestDb();
  try {
    await ensureUnitPhotoSchema();
    await t.client.query(`INSERT INTO unit_photos (sku, path, url, position) VALUES
      ('A-1','p/a1','/api/photo/A-1-1',0), ('A-1','p/a2','/api/photo/A-1-2',1), ('B-2','p/b1','/api/photo/B-2-1',0)`);
    equal(await photoCounts(['A-1', 'C-3']), { 'A-1': 2, 'C-3': 0 });
    equal(Object.entries(await photoCounts()).sort(), [['A-1', 2], ['B-2', 1]]);
  } finally { t.done(); }
});

test('removing the last photo reports 0 to RS Ops', async () => {
  const t = await withTestDb();
  const sent = [];
  const realFetch = globalThis.fetch;
  process.env.RSOPS_INTAKE_KEY = 'k';
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{"ok":true}', { status: 200 }); };
  try {
    await ensureUnitPhotoSchema();
    const { rows } = await t.client.query(`INSERT INTO unit_photos (sku, path, url, position) VALUES ('A-1','','/api/photo/A-1-1',0) RETURNING id`);
    await deleteUnitPhoto(rows[0].id);
    equal(sent.length, 1);
    equal(sent[0].url.endsWith('/api/intake/bb-photos'), true);
    equal(sent[0].body, { photos: { 'A-1': 0 } });
  } finally { globalThis.fetch = realFetch; delete process.env.RSOPS_INTAKE_KEY; t.done(); }
});
