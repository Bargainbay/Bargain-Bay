// Order queries shared by /order, /account, /admin and the webhook.
import { query, withTransaction, hasDb } from './db';

// Record (or correct) the cost of a sold unit directly on its order line. Used to
// fix sales whose unit wasn't cost-linked (e.g. invoiced under a model number, or
// a unit not yet in the tracker). Analytics prefers order_items.cost over the
// products.cost join, so this makes the dashboard count it. Returns rows updated.
export async function setOrderItemCost(orderNumber, sku, cost) {
  if (!hasDb()) throw new Error('Database not configured.');
  await query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)').catch(() => {});
  const c = Number(cost);
  if (!(c >= 0)) throw new Error('Cost must be a non-negative number.');
  const { rowCount } = await query(
    `UPDATE order_items SET cost = $3
       WHERE sku = $2 AND order_id = (SELECT id FROM orders WHERE order_number = $1)`,
    [String(orderNumber).trim(), String(sku).trim(), c]
  );
  return { updated: rowCount };
}

// Create a fulfilment order from a paid invoice, so an invoiced (or quote-then-
// invoiced) sale enters the same Operations pipeline as a checkout order. Lands
// as 'confirmed' (money's in). No reservations — the units were already marked
// sold by the invoice. Links to the buyer's account if their email has one.
// inv: { invoiceNumber, email, name, phone, deliveryMethod, address, city, postal,
//        subtotal, hst, total, paymentMethod, items:[{ sku, title, price }] }
export async function createOrderFromInvoice(inv) {
  let userId = null;
  try {
    const { rows } = await query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [inv.email]);
    userId = rows[0]?.id || null;
  } catch { /* no account link — fine */ }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, email, name, phone, delivery_method, address, city, postal,
                           status, subtotal, hst, total, payment_method, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9,$10,$11,$12,$13)
       RETURNING id`,
      [userId, inv.email, inv.name || null, inv.phone || null,
       inv.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
       inv.address || null, inv.city || null, inv.postal || null,
       Number(inv.subtotal) || 0, Number(inv.hst) || 0, Number(inv.total) || 0,
       inv.paymentMethod || null, inv.invoiceNumber ? `Created from invoice ${inv.invoiceNumber}` : null]
    );
    const orderId = rows[0].id;
    const { rows: numbered } = await client.query(
      `UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1 RETURNING order_number`,
      [orderId]
    );
    await client.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)').catch(() => {});
    for (const it of (inv.items || [])) {
      await client.query(
        'INSERT INTO order_items (order_id, sku, title, price, cost) VALUES ($1,$2,$3,$4,$5)',
        [orderId, it.sku || null, it.title || '(item)', Number(it.price) || 0, it.cost != null ? Number(it.cost) : null]
      );
    }
    return { id: orderId, orderNumber: numbered[0].order_number };
  });
}

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

export async function getOrderByStripeSession(sessionId) {
  const { rows } = await query('SELECT * FROM orders WHERE stripe_session_id = $1', [sessionId]);
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
