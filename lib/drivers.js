// Delivery drivers + scheduling, layered on the existing users/orders tables.
// A driver is a normal user account with users.is_driver = true; they sign in
// via /login and work their stops at /driver.
import { query, hasDb } from './db';

// True if the logged-in session belongs to a driver account.
export async function isDriver(session) {
  if (!session?.userId || !hasDb()) return false;
  try {
    const { rows } = await query('SELECT is_driver FROM users WHERE id = $1', [session.userId]);
    return !!rows[0]?.is_driver;
  } catch {
    return false;
  }
}

export async function listDrivers() {
  if (!hasDb()) return [];
  const { rows } = await query(
    'SELECT id, name, email, phone FROM users WHERE is_driver = true ORDER BY name NULLS LAST, email'
  );
  return rows;
}

// Owner action: flip a user's driver flag by email. The person must already have
// an account (signed up) — returns { ok:false, reason } if no user matches.
export async function setDriverByEmail(email, on) {
  if (!hasDb()) throw new Error('Database not configured');
  const { rows } = await query(
    'UPDATE users SET is_driver = $2 WHERE email = $1 RETURNING id, name, email',
    [String(email || '').trim().toLowerCase(), !!on]
  );
  if (!rows.length) return { ok: false, reason: 'No account with that email — have them sign up first.' };
  return { ok: true, user: rows[0] };
}

// Owner action: assign a delivery date and/or driver to a delivery order.
export async function assignDelivery(orderId, { deliveryDate, driverId }) {
  if (!hasDb()) throw new Error('Database not configured');
  const { rows } = await query(
    `UPDATE orders
        SET delivery_date = $2,
            driver_id     = $3
      WHERE id = $1 AND delivery_method = 'delivery'
      RETURNING id, order_number, delivery_date, driver_id`,
    [orderId, deliveryDate || null, driverId || null]
  );
  return rows[0] || null;
}

// A driver's active stops: assigned delivery orders not yet delivered/cancelled,
// soonest first. Includes the items for each order.
export async function driverDeliveries(driverId) {
  if (!hasDb() || !driverId) return [];
  const { rows } = await query(
    `SELECT id, order_number, name, email, phone, address, city, postal,
            status, delivery_date, total
       FROM orders
      WHERE driver_id = $1 AND delivery_method = 'delivery'
        AND status NOT IN ('delivered','cancelled')
      ORDER BY delivery_date ASC NULLS LAST, id ASC`,
    [driverId]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: items } = await query(
    'SELECT order_id, sku, title FROM order_items WHERE order_id = ANY($1) ORDER BY id',
    [ids]
  );
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(it);
  }
  return rows.map((o) => ({
    ...o,
    delivery_date: o.delivery_date ? o.delivery_date.toISOString().slice(0, 10) : null,
    items: byOrder.get(o.id) || []
  }));
}

// Verify an order is assigned to this driver (guards driver-only mutations).
export async function orderBelongsToDriver(orderId, driverId) {
  if (!hasDb()) return false;
  const { rows } = await query('SELECT 1 FROM orders WHERE id = $1 AND driver_id = $2', [orderId, driverId]);
  return rows.length > 0;
}
