// Photos of one physical unit, taken by us.
//
// The storefront's real-unit photography normally comes from RS Ops over a feed
// (lib/rsops.js) — every machine it lists has been through the bench. A vendor
// drop-off never goes through that floor: it arrives working, the sales floor
// photographs it on the spot and lists it. Those pictures need somewhere to
// live, and it cannot be `products.image_url`:
//
//   upsertProducts rewrites EVERY column of a product row on every sync, and
//   pressing "Sync inventory from tracker" is the very next thing the rep is
//   told to do. A photo stored on the product row would be gone before the unit
//   was on sale.
//
// So: their own table, keyed by SKU, joined on read. A sync can't touch them and
// a unit that is relisted later still has its pictures.
//
// The files sit in the PRIVATE Blob store and are served through /api/photo/<key>
// — the same proxy the rehost tool already used, so the storefront, the OG tags
// and the Meta feed all get a stable public URL on our own domain.
import { put, del } from '@vercel/blob';
import { hasDb, query } from './db';

let _schema = null;
export function ensureUnitPhotoSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS unit_photos (
        id         serial PRIMARY KEY,
        sku        text NOT NULL,
        path       text NOT NULL,
        url        text NOT NULL,
        position   int NOT NULL DEFAULT 0,
        created_by text,
        created_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_unit_photos_sku ON unit_photos(sku, position, id);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// A blob key has to survive being a URL path segment and being handed back to
// /api/photo/<key>, which sanitises the same way. Keep the two in step.
const keyFor = (sku, n) => `${String(sku).trim().replace(/[^\w.-]/g, '_')}-${n}`;

export const MAX_PHOTOS = 8;
const MAX_BYTES = 12 * 1024 * 1024;

// Store a set of photos against a SKU. Positions continue from what is already
// there, so "add two more" doesn't renumber the ones the page is already using.
//
// Each file is attempted on its own and failures are COUNTED, never swallowed:
// a rep who selects six pictures, sees four, and is told nothing concludes the
// page eats photos. Returns { photos, failed }.
export async function addUnitPhotos(sku, files, { createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Photo storage is not configured (BLOB_READ_WRITE_TOKEN).');
  const id = String(sku || '').trim();
  if (!id) throw new Error('Missing SKU.');
  await ensureUnitPhotoSchema();

  const { rows: existing } = await query(
    'SELECT COALESCE(MAX(position), -1) AS max_pos, COUNT(*)::int AS n FROM unit_photos WHERE sku = $1', [id]
  );
  let pos = Number(existing[0].max_pos) + 1;
  const room = MAX_PHOTOS - Number(existing[0].n);
  if (room <= 0) throw new Error(`That unit already has ${MAX_PHOTOS} photos.`);

  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, room);
  const photos = [];
  let failed = 0;
  for (const file of list) {
    if (file.size > MAX_BYTES) { failed++; continue; }
    if (file.type && !/^image\//i.test(file.type)) { failed++; continue; }
    const key = keyFor(id, pos + 1);
    try {
      const res = await put(`products/${key}.jpg`, file, {
        access: 'private',
        addRandomSuffix: false, // stable, key-addressed — a re-upload replaces
        allowOverwrite: true,
        contentType: file.type || 'image/jpeg'
      });
      const { rows } = await query(
        `INSERT INTO unit_photos (sku, path, url, position, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, sku, url, position`,
        [id, res.pathname, `/api/photo/${key}`, pos, createdBy || null]
      );
      photos.push(rows[0]);
      pos++;
    } catch (e) {
      console.error('unit photo upload failed', id, e?.message || e);
      failed++;
    }
  }
  return { photos, failed };
}

// NOTE: the read paths deliberately do NOT run ensureUnitPhotoSchema(). They are
// on the storefront's hot path and a public product page has no business issuing
// DDL; the table is created by the schema migration and by the first upload, and
// until then these simply report no photos.
export async function listUnitPhotos(sku) {
  if (!hasDb() || !sku) return [];
  try {
    const { rows } = await query(
      'SELECT id, url, position FROM unit_photos WHERE sku = $1 ORDER BY position, id', [sku]
    );
    return rows;
  } catch (e) {
    console.error('unit photos read failed', e?.message || e);
    return [];
  }
}

// One query for a whole page of units. Soft-fails to "no photos" in every error
// path — the storefront must render whether or not this table exists yet.
export async function photosBySku(skus = []) {
  const map = new Map();
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!hasDb() || !list.length) return map;
  try {
    const { rows } = await query(
      'SELECT sku, url, position FROM unit_photos WHERE sku = ANY($1) ORDER BY position, id', [list]
    );
    for (const r of rows) {
      if (!map.has(r.sku)) map.set(r.sku, []);
      map.get(r.sku).push({ url: r.url, position: r.position });
    }
  } catch (e) {
    console.error('unit photos read failed', e?.message || e);
  }
  return map;
}

// Remove one picture. The blob goes with it — a photo nobody can reach from the
// site but that still answers on /api/photo/<key> is a picture we think we
// deleted. Best-effort on the blob: the row is the record.
export async function deleteUnitPhoto(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureUnitPhotoSchema();
  const { rows } = await query('DELETE FROM unit_photos WHERE id = $1 RETURNING sku, path', [Number(id)]);
  if (!rows.length) return { deleted: 0 };
  try { if (rows[0].path) await del(rows[0].path); }
  catch (e) { console.error('unit photo blob delete failed', e?.message || e); }
  return { deleted: 1, sku: rows[0].sku };
}
