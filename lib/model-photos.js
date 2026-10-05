// Stock photos by MODEL, managed from /admin/photos.
//
// A row in `model_photos` wins over data/images.json; the file stays as the
// fallback, so the existing entries need no migrating. `imageFor` is synchronous
// and called from a dozen places, so instead of making it async the overrides
// are loaded into a short-lived in-process map (`warmModelPhotos`) at the top of
// the storefront reads, and `modelImage` consults that map.
//
// Every read soft-fails to "no overrides": the storefront must render whether or
// not this table exists yet.
import { put, del } from '@vercel/blob';
import { hasDb, query } from './db';
import { setModelOverrides, modelImage, normalizeImg } from './images';
import modelImages from '../data/images.json';

const TTL_MS = 30 * 1000;
let loadedAt = 0;

export async function warmModelPhotos(force = false) {
  if (!hasDb()) return;
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    const { rows } = await query('SELECT model, url FROM model_photos');
    setModelOverrides(new Map(rows.map((r) => [r.model, r.url])));
    loadedAt = Date.now();
  } catch (e) {
    // Missing table / blip: keep whatever we had. Retry next request.
    console.error('model photos read failed', e?.message || e);
  }
}

const MAX_BYTES = 12 * 1024 * 1024;
const safe = (s) => String(s).trim().replace(/[^\w.-]/g, '_');

// A link is stored as typed. We do NOT fetch it to check: several manufacturer
// CDNs 403 every server-side request while serving a browser fine (CLAUDE.md,
// "Adding to data/images.json"), so a server check would reject good URLs. The
// screen previews the link in the browser instead, which is the real test.
export function validPhotoUrl(raw) {
  const u = String(raw || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(u) || u.length > 2000) return null;
  return u;
}

async function dropFile(path) {
  try { if (path) await del(path); } catch (e) { console.error('model photo blob delete failed', e?.message || e); }
}

// Set a model's photo from a link or an uploaded file. Replacing one removes the
// file we held for the old one, if any.
export async function setModelPhoto(model, { url, file }, { createdBy } = {}) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const m = String(model || '').trim();
  if (!m) throw new Error('Missing model.');
  const { rows: prev } = await query('SELECT path FROM model_photos WHERE model = $1', [m]);

  let finalUrl = null;
  let path = null;
  if (file && typeof file === 'object' && file.size > 0) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Photo storage is not configured (BLOB_READ_WRITE_TOKEN).');
    if (file.size > MAX_BYTES) throw new Error('That file is over 12 MB.');
    if (file.type && !/^image\//i.test(file.type)) throw new Error('That file is not an image.');
    // Unique key per upload: /api/photo is cached for an hour, and a re-upload
    // under the same key would keep showing the old picture.
    const key = `model-${safe(m)}-${Date.now().toString(36)}`;
    const res = await put(`products/${key}.jpg`, file, {
      access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: file.type || 'image/jpeg',
    });
    finalUrl = `/api/photo/${key}`;
    path = res.pathname;
  } else {
    finalUrl = validPhotoUrl(url);
    if (!finalUrl) throw new Error('Paste a full https:// link to an image, or choose a file.');
  }
  await query(
    `INSERT INTO model_photos (model, url, path, created_by, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (model) DO UPDATE SET url=EXCLUDED.url, path=EXCLUDED.path, created_by=EXCLUDED.created_by, updated_at=now()`,
    [m, finalUrl, path, createdBy || null]
  );
  if (prev[0]?.path && prev[0].path !== path) await dropFile(prev[0].path);
  await warmModelPhotos(true);
  return { model: m, url: finalUrl };
}

// Remove the override. The model then falls back to data/images.json, or to the
// placeholder if it has no entry there either.
export async function clearModelPhoto(model) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query('DELETE FROM model_photos WHERE model = $1 RETURNING path', [String(model || '').trim()]);
  if (rows[0]?.path) await dropFile(rows[0].path);
  await warmModelPhotos(true);
  return { cleared: rows.length };
}

// Every model currently listed, with where its photo comes from, missing first.
// Read from `products` (what the site shows), not the tracker.
export async function modelPhotoRows() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT model, MIN(make) AS make, MIN(category) AS category, MIN(title) AS title,
            COUNT(*)::int AS units, (array_agg(sku ORDER BY sku))[1:4] AS skus
       FROM products WHERE active = true AND COALESCE(TRIM(model),'') <> ''
      GROUP BY model`
  );
  const { rows: over } = await query('SELECT model, url FROM model_photos').catch(() => ({ rows: [] }));
  const overrides = new Map(over.map((r) => [r.model, r.url]));
  const out = rows.map((r) => {
    const own = overrides.get(r.model);
    const source = own ? 'upload' : modelImages[r.model] ? 'file' : 'missing';
    return { ...r, source, image: own || normalizeImg(modelImages[r.model] || null) };
  });
  const rank = { missing: 0, file: 1, upload: 1 };
  return out.sort((a, b) => rank[a.source] - rank[b.source] || b.units - a.units || a.model.localeCompare(b.model));
}
