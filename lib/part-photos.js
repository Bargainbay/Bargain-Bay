// Pictures of a part, taken when it is booked in (or any time after).
//
// Keyed by PART (the catalogue row), not by piece: a photo says what the part
// is, and that same row is what a parts website will list and sell. Files go to
// the private Blob store and are served through /api/part-photo/<id>, which is
// public on purpose - a photo of an igniter is storefront material, and a stable
// URL on our own domain is what a future parts site needs. Nothing here carries
// cost, spot or stock.
import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { hasDb, query } from './db';

export const MAX_PART_PHOTOS = 6;
const MAX_BYTES = 12 * 1024 * 1024;

let _schema = null;
export function ensurePartPhotoSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS part_photos (
        id         serial PRIMARY KEY,
        part_id    int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
        path       text NOT NULL,
        position   int NOT NULL DEFAULT 0,
        created_by text,
        created_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_part_photos_part ON part_photos(part_id, position, id);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

const urlFor = (id) => `/api/part-photo/${id}`;

// Each file is attempted on its own and failures are counted, never swallowed.
export async function addPartPhotos(partId, files, { createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Photo storage is not configured (BLOB_READ_WRITE_TOKEN).');
  const pid = Number(partId);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Which part?');
  await ensurePartPhotoSchema();
  const { rows: ex } = await query(
    'SELECT COALESCE(MAX(position), -1) AS max_pos, COUNT(*)::int AS n FROM part_photos WHERE part_id = $1', [pid]);
  let pos = Number(ex[0].max_pos) + 1;
  const room = MAX_PART_PHOTOS - Number(ex[0].n);
  if (room <= 0) throw new Error(`That part already has ${MAX_PART_PHOTOS} photos.`);
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, room);
  const photos = [];
  let failed = 0;
  for (const file of list) {
    if (file.size > MAX_BYTES || (file.type && !/^image\//i.test(file.type))) { failed++; continue; }
    try {
      const res = await put(`parts/${pid}-${randomUUID()}.jpg`, file, {
        access: 'private', addRandomSuffix: false, contentType: file.type || 'image/jpeg'
      });
      const { rows } = await query(
        'INSERT INTO part_photos (part_id, path, position, created_by) VALUES ($1,$2,$3,$4) RETURNING id, position',
        [pid, res.pathname, pos, createdBy || null]);
      photos.push({ id: rows[0].id, url: urlFor(rows[0].id), position: rows[0].position });
      pos++;
    } catch (e) {
      console.error('part photo upload failed', pid, e?.message || e);
      failed++;
    }
  }
  return { photos, failed };
}

// Soft-fails to "no photos": the shelf must render whether or not the table exists.
export async function listPartPhotos(partId) {
  if (!hasDb() || !partId) return [];
  try {
    const { rows } = await query('SELECT id, position FROM part_photos WHERE part_id = $1 ORDER BY position, id', [Number(partId)]);
    return rows.map((r) => ({ id: r.id, url: urlFor(r.id), position: r.position }));
  } catch { return []; }
}

export async function partPhotoPath(id) {
  if (!hasDb()) return null;
  try {
    const { rows } = await query(
      `SELECT ph.path, p.part_number, p.name FROM part_photos ph JOIN parts p ON p.id = ph.part_id WHERE ph.id = $1`, [Number(id)]);
    return rows[0] ? { path: rows[0].path, label: rows[0].part_number || rows[0].name || `part-${id}` } : null;
  } catch { return null; }
}

export async function deletePartPhoto(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensurePartPhotoSchema();
  const { rows } = await query('DELETE FROM part_photos WHERE id = $1 RETURNING path', [Number(id)]);
  if (!rows.length) return { deleted: 0 };
  try { if (rows[0].path) await del(rows[0].path); } catch (e) { console.error('part photo blob delete failed', e?.message || e); }
  return { deleted: 1 };
}
