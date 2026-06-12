// Order queries shared by /order, /account, /admin and the webhook.
import { query } from './db';

async function attachItems(orders) {
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const { rows: items } = await query(
    'SELECT id, order_id, sku, title, price FROM order_items WHERE order_id = ANY($1) ORDER BY id',
    [ids]
  );
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(it);
  }
  return orders.map((o) => ({ ...o, items: byOrder.get(o.id) || [] }));
}

export async function getOrderByNumber(orderNumber) {
  const { rows } = await query('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
  if (!rows.length) return null;
  return (await attachItems(rows))[0];
}

export async function getOrderByCloverSession(sessionId) {
  const { rows } = await query('SELECT * FROM orders WHERE clover_session_id = $1', [sessionId]);
  if (!rows.length) return null;
  return (await attachItems(rows))[0];
}

export async function getOrdersForUser(userId) {
  const { rows } = await query(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return attachItems(rows);
}

export async function getAllOrders(limit = 200) {
  const { rows } = await query('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1', [limit]);
  return attachItems(rows);
}

export async function updateOrderStatus(id, status) {
  const { rows } = await query(
    'UPDATE orders SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return rows[0] || null;
}

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled'
];
