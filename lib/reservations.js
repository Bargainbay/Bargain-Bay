// Reservation / availability layer on Postgres.
// Every unit is one-of-a-kind (qty 1), so "available" means:
//   - not on any order whose status is past pending_payment and not cancelled, AND
//   - no active (unexpired) reservation row.
// Orders stuck in pending_payment free their units automatically when the
// 30-minute reservation expires, so abandoned checkouts never strand stock.
import { query, hasDb } from './db';

export const RESERVATION_MINUTES = 30;

// Set of SKUs that are NOT purchasable right now.
// Degrades gracefully: with no database configured everything reads available.
export async function unavailableSkus(skus = null) {
  if (!hasDb()) return new Set();
  try {
    const params = [];
    let skuAnd = '';
    if (skus && skus.length) {
      params.push(skus);
      skuAnd = 'AND oi.sku = ANY($1)';
    }
    const sold = await query(
      `SELECT DISTINCT oi.sku
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status NOT IN ('cancelled','pending_payment') ${skuAnd}`,
      params
    );
    const reserved = await query(
      `SELECT sku FROM reservations
        WHERE expires_at > now() ${skus && skus.length ? 'AND sku = ANY($1)' : ''}`,
      params
    );
    return new Set([...sold.rows, ...reserved.rows].map((r) => r.sku));
  } catch (e) {
    console.error('unavailableSkus failed (treating all as available):', e.message);
    return new Set();
  }
}

export async function isUnavailable(sku) {
  const set = await unavailableSkus([sku]);
  return set.has(sku);
}

// Atomically reserve a list of SKUs for an order inside an existing
// transaction (pass the pg client from withTransaction). Each SKU is claimed
// with a single race-safe statement: the upsert only steals an existing row
// when it has expired; concurrent inserts on the same PK serialize, so the
// loser's WHERE clause fails and we throw → the whole transaction rolls back.
export async function reserveWithClient(client, skus, orderId) {
  for (const sku of skus) {
    const res = await client.query(
      `INSERT INTO reservations (sku, order_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
       ON CONFLICT (sku) DO UPDATE
         SET order_id = EXCLUDED.order_id, expires_at = EXCLUDED.expires_at
         WHERE reservations.expires_at < now()
       RETURNING sku`,
      [sku, orderId, String(RESERVATION_MINUTES)]
    );
    if (res.rowCount === 0) {
      const err = new Error(`Unit ${sku} is currently held by another checkout`);
      err.code = 'SKU_HELD';
      err.sku = sku;
      throw err;
    }
  }
}

// Free reservations (e.g. order cancelled or Clover session failed to start).
export async function releaseForOrder(orderId) {
  if (!hasDb()) return;
  await query('DELETE FROM reservations WHERE order_id = $1', [orderId]);
}

// Housekeeping: drop expired reservation rows (they no longer block anything,
// this is hygiene) and cancel pending_payment orders older than 24h so
// abandoned checkouts don't pile up. Called by /api/cron/expire-reservations
// and opportunistically (fire-and-forget) from /api/checkout.
export async function expireReservations() {
  if (!hasDb()) return { expiredReservations: 0, cancelledOrders: 0 };
  const expired = await query(
    `DELETE FROM reservations r
      WHERE r.expires_at < now()
        AND (r.order_id IS NULL OR EXISTS (
              SELECT 1 FROM orders o
               WHERE o.id = r.order_id AND o.status IN ('pending_payment','cancelled')))
      RETURNING r.sku`
  );
  const cancelled = await query(
    `UPDATE orders SET status = 'cancelled'
      WHERE status = 'pending_payment' AND created_at < now() - interval '24 hours'
      RETURNING id`
  );
  if (cancelled.rowCount) {
    await query('DELETE FROM reservations WHERE order_id = ANY($1)', [cancelled.rows.map((r) => r.id)]);
  }
  return { expiredReservations: expired.rowCount, cancelledOrders: cancelled.rowCount };
}
