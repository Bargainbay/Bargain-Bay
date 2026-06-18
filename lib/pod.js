// Proof-of-delivery storage helpers. Files live in the PRIVATE Vercel Blob
// store; we keep only the blob pathname here and stream the bytes back through an
// admin-gated route (see /api/admin/pod). Never expose blob URLs to the public.
import { hasDb, query } from './db';

export async function addPodPhoto(orderId, url, pathname) {
  await query('INSERT INTO pod_photos (order_id, url, pathname) VALUES ($1,$2,$3)', [orderId, url, pathname]);
}

export async function setSignaturePath(orderId, pathname) {
  await query('UPDATE orders SET pod_signature = $2 WHERE id = $1', [orderId, pathname]);
}

// Map of orderId -> [photoId,...] for a set of orders (one query).
export async function podPhotosForOrders(ids) {
  if (!hasDb() || !ids || !ids.length) return new Map();
  const { rows } = await query('SELECT id, order_id FROM pod_photos WHERE order_id = ANY($1) ORDER BY id', [ids]);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.order_id)) m.set(r.order_id, []);
    m.get(r.order_id).push(r.id);
  }
  return m;
}

export async function podPhotoPath(id) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT pathname FROM pod_photos WHERE id = $1', [id]);
  return rows[0]?.pathname || null;
}

export async function orderSignaturePath(orderId) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT pod_signature FROM orders WHERE id = $1', [orderId]);
  return rows[0]?.pod_signature || null;
}
