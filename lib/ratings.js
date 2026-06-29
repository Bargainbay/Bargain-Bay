// Post-delivery customer satisfaction (CSAT). One rating per delivered order,
// captured from a tokenised public link in the "delivered" email.
import { query, hasDb } from './db';
import { verifyLinkToken } from './links';

let ensured = null;
export async function ensureRatingsSchema() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(`CREATE TABLE IF NOT EXISTS order_ratings (
    id serial PRIMARY KEY,
    order_id int REFERENCES orders(id) ON DELETE CASCADE,
    order_number text,
    rating int CHECK (rating BETWEEN 1 AND 5),
    comment text,
    created_at timestamptz DEFAULT now()
  )`).catch((e) => { ensured = null; throw e; });
  return ensured;
}

const n = (v) => Number(v || 0);

// Submit a rating for an order, verifying the order link token (kind 'order').
export async function submitRating({ orderNumber, token, rating, comment }) {
  if (!hasDb()) throw new Error('No database');
  if (!verifyLinkToken('order', orderNumber, token)) throw new Error('Invalid or expired link.');
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw new Error('Pick a rating from 1 to 5.');
  await ensureRatingsSchema();
  const { rows } = await query('SELECT id FROM orders WHERE order_number = $1', [orderNumber]);
  if (!rows.length) throw new Error('Order not found.');
  const orderId = rows[0].id;
  // One rating per order — replace any prior one.
  await query('DELETE FROM order_ratings WHERE order_id = $1', [orderId]);
  await query(
    'INSERT INTO order_ratings (order_id, order_number, rating, comment) VALUES ($1,$2,$3,$4)',
    [orderId, orderNumber, r, comment ? String(comment).slice(0, 1000) : null]
  );
  return true;
}

// Aggregate CSAT stats. `sinceIso` optional lower bound on created_at.
export async function ratingStats() {
  if (!hasDb()) return { count: 0, avg: 0, dist: [0, 0, 0, 0, 0], recent: [] };
  try {
    await ensureRatingsSchema();
    const a = (await query(`
      SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS avg,
        COUNT(*) FILTER (WHERE rating=1) AS r1, COUNT(*) FILTER (WHERE rating=2) AS r2,
        COUNT(*) FILTER (WHERE rating=3) AS r3, COUNT(*) FILTER (WHERE rating=4) AS r4,
        COUNT(*) FILTER (WHERE rating=5) AS r5
      FROM order_ratings`)).rows[0] || {};
    const recent = (await query(`
      SELECT order_number, rating, comment, created_at FROM order_ratings
      WHERE comment IS NOT NULL AND comment <> '' ORDER BY created_at DESC LIMIT 6`)).rows
      .map((r) => ({ orderNumber: r.order_number, rating: n(r.rating), comment: r.comment, createdAt: r.created_at ? r.created_at.toISOString() : null }));
    return {
      count: n(a.count), avg: n(a.avg),
      dist: [n(a.r1), n(a.r2), n(a.r3), n(a.r4), n(a.r5)],
      recent
    };
  } catch {
    return { count: 0, avg: 0, dist: [0, 0, 0, 0, 0], recent: [] };
  }
}
