// 2026-11-14: a unit's page showed none of its own photos for a day. getById read
// rows[0].sku, but the query aliases sku AS id, so the lookup ran with undefined.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { getById } from '../lib/inventory.js';
import { ensureUnitPhotoSchema } from '../lib/unit-photos.js';

suite('product page — own photos');

test('getById returns the photos saved against that unit', async () => {
  const t = await withTestDb();
  try {
    await ensureUnitPhotoSchema();
    await t.client.query(`INSERT INTO products (sku, make, model, category, title, condition, price, active)
      VALUES ('SS-Caledon-Lot-001', 'LG', 'DLEX3250W', 'Dryer', 'LG Dryer', 'Refurbished', 399, true)`);
    await t.client.query(`INSERT INTO unit_photos (sku, path, url, position) VALUES
      ('SS-Caledon-Lot-001', 'products/a.jpg', '/api/photo/SS-Caledon-Lot-001-1', 0),
      ('SS-Caledon-Lot-001', 'products/b.jpg', '/api/photo/SS-Caledon-Lot-001-2', 1)`);
    const u = await getById('SS-Caledon-Lot-001');
    equal((u.photos || []).map((p) => p.url), ['/api/photo/SS-Caledon-Lot-001-1', '/api/photo/SS-Caledon-Lot-001-2']);
  } finally { t.done(); }
});
