// Order queries shared by /order, /account, /admin and the webhook.
import { query, withTransaction, hasDb } from './db';
import { round2, HST_RATE } from './constants';
import { markUnitsSold } from './catalog-sync';
import { reserveWithClient, OFFLINE_HOLD_MINUTES, unavailableSkus } from './reservations';
import { getMany } from './inventory';
import { upsertCustomer } from './customers';
import { mirrorOrderToWebInvoice } from './web-invoices';

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

// Create a fulfilment order from an invoice, so an invoiced (or quote-then-
// invoiced) sale enters the same Operations pipeline as a checkout order and
// gets a BB- number the moment it exists. Links to the buyer's account if their
// email has one.
// inv: { invoiceNumber, email, name, phone, deliveryMethod, address, city, postal,
//        subtotal, hst, total, paymentMethod, items:[{ sku, title, price, cost }] }
// opts:
//   status    'confirmed' (money's in — the legacy backfill path) or
//             'pending_payment' (raised but not yet settled: the order exists and
//             is workable, and the units are held by a long reservation rather
//             than by the order's own status).
//   createdAt Date/ISO the order is dated to. Revenue is bucketed on this, so an
//             invoice passes its ISSUE date — that's what puts a deposit sale on
//             the dashboard the day it was written rather than the day it clears.
//   holdSkus  reserve the line SKUs so the units come off bargainbay.ca right
//             away. Best-effort and OUTSIDE the transaction: a unit that is
//             already spoken for must not stop the order being created, it comes
//             back in `contested` for the caller to warn about.
export async function createOrderFromInvoice(inv, { status = 'confirmed', createdAt = null, holdSkus = false } = {}) {
  let userId = null;
  try {
    const { rows } = await query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [inv.email]);
    userId = rows[0]?.id || null;
  } catch { /* no account link — fine */ }

  const st = status === 'pending_payment' ? 'pending_payment' : 'confirmed';
  const order = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, email, name, phone, delivery_method, address, city, postal,
                           status, subtotal, hst, total, payment_method, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$14,$9,$10,$11,$12,$13, COALESCE($15::timestamptz, now()))
       RETURNING id`,
      [userId, inv.email, inv.name || null, inv.phone || null,
       inv.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
       inv.address || null, inv.city || null, inv.postal || null,
       Number(inv.subtotal) || 0, Number(inv.hst) || 0, Number(inv.total) || 0,
       inv.paymentMethod || null, inv.invoiceNumber ? `Created from invoice ${inv.invoiceNumber}` : null,
       st, createdAt ? new Date(createdAt).toISOString() : null]
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

  const contested = holdSkus ? await holdInvoiceSkus(order.id, (inv.items || []).map((it) => it.sku)) : [];
  return { ...order, contested };
}

// Hold an invoice's units off the storefront for as long as the invoice is live.
// Uses the same long offline reservation the pay-later web checkout uses, so an
// appliance held on a deposit can't be sold out from under the customer. Each SKU
// is claimed independently: one already held by somebody else is reported rather
// than aborting the rest. Returns the SKUs that could NOT be held.
export async function holdInvoiceSkus(orderId, skus = []) {
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!hasDb() || !list.length) return [];
  const contested = [];
  for (const sku of list) {
    try {
      await withTransaction((client) => reserveWithClient(client, [sku], orderId, OFFLINE_HOLD_MINUTES));
    } catch (e) {
      if (e.code === 'SKU_HELD') contested.push(sku);
      else console.error('invoice SKU hold failed', sku, e.message);
    }
  }
  return contested;
}

// Release an invoice's fulfilment order — the invoice was voided, deleted, or
// refunded. Cancelling takes the money off the revenue dashboard and dropping the
// reservation puts the unit back on bargainbay.ca; both are what "automatically
// adjust" means. Idempotent and best-effort.
export async function cancelInvoiceOrder(orderId) {
  if (!hasDb() || !orderId) return { cancelled: false };
  let cancelled = false;
  try {
    const r = await query("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' RETURNING id", [orderId]);
    cancelled = !!r.rowCount;
  } catch (e) { console.error('cancelInvoiceOrder failed', e.message); }
  await query('DELETE FROM reservations WHERE order_id = $1', [orderId]).catch(() => {});
  return { cancelled };
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

// Account page: the customer's whole order history — account-linked orders PLUS
// guest/invoiced orders placed under the same email before (or without) login.
export async function getOrdersForCustomer(userId, email) {
  const { rows } = await query(
    'SELECT * FROM orders WHERE user_id = $1 OR lower(email) = lower($2) ORDER BY created_at DESC',
    [userId, String(email || '').trim()]
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
  // A storefront sale's invoice follows its order — confirm the order and the
  // invoice reads paid; cancel it and the invoice voids. Best-effort and one-way
  // (never writes back to orders), so it can't loop or block the status change.
  if (rows[0]) await mirrorOrderToWebInvoice(id, status);
  return rows[0] || null;
}

// The statuses an admin can SET directly (the Operations dropdown / PATCH).
// 'refunded' is deliberately absent — a refund must go through refundOrder()
// so the units relist and the money comes off the books, never a raw flip.
export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled'
];

// ---------------------------------------------------------------------------
// Post-payment order editing: contact/fulfilment, line items, and refunds.
// Invoice-bridged orders keep their money edits on the INVOICE (its editor and
// refund flows already sync the bridged order); editing them here would let the
// two records disagree, so item edits/refunds on those are refused with a
// pointer to the invoice. Contact fixes are allowed everywhere.
// ---------------------------------------------------------------------------

// Paid = the unit(s) are in the sold ledger; pending = they're only reserved.
const PAID_STATUSES = ['confirmed', 'ready', 'out_for_delivery', 'delivered'];

// Self-provision the refund columns + the widened status CHECK ('refunded' was
// not in the original constraint). Mirrors db/schema.sql. Cached per process.
let _editSchema = null;
function ensureOrderEditSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_editSchema) {
    _editSchema = query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check
        CHECK (status IN ('pending_payment','confirmed','ready','out_for_delivery','delivered','cancelled','refunded'));
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);
    `).catch((e) => { _editSchema = null; throw e; });
  }
  return _editSchema;
}

const torontoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

// Accept a numeric id or a public 'BB-####' number.
async function loadOrder(idOrNumber) {
  const s = String(idOrNumber ?? '').trim();
  const byNumber = /^bb-/i.test(s);
  const { rows } = await query(
    byNumber ? 'SELECT * FROM orders WHERE upper(order_number) = upper($1)' : 'SELECT * FROM orders WHERE id = $1',
    [byNumber ? s : Number(s)]
  );
  if (!rows.length) throw new Error(`Order ${s} not found.`);
  const order = rows[0];
  const { rows: items } = await query(
    'SELECT id, sku, title, price, cost FROM order_items WHERE order_id = $1 ORDER BY id', [order.id]
  );
  return { order, items };
}

// The invoice this order was bridged from, when there is one.
export async function orderInvoiceLink(orderId) {
  try {
    const { rows } = await query('SELECT id, number FROM invoices WHERE order_id = $1 LIMIT 1', [Number(orderId)]);
    return rows[0] || null;
  } catch { return null; }
}

// Scoped storefront relist — product-level only, exactly these SKUs (does NOT
// cancel orders; same shape as the invoice refund relist).
async function relistSkus(skus) {
  const list = [...new Set((skus || []).filter(Boolean))];
  if (!list.length) return 0;
  const r = await query(
    `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                         sold_ref = null, tracker_synced = false, synced_at = now()
      WHERE sku = ANY($1)`,
    [list]
  );
  return r.rowCount || 0;
}

// Fix the customer/fulfilment details on an existing order (typo'd address,
// changed phone, pickup↔delivery switch). Never touches money — totals stay as
// sold; if switching to delivery should be charged, edit the line items too.
export async function updateOrderContact(idOrNumber, { name, email, phone, deliveryMethod, address, city, postal } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureOrderEditSchema();
  const { order } = await loadOrder(idOrNumber);

  const next = {
    name: String(name ?? order.name ?? '').trim() || null,
    email: String(email ?? order.email ?? '').trim().toLowerCase(),
    phone: String(phone ?? order.phone ?? '').trim() || null,
    deliveryMethod: deliveryMethod === 'delivery' || (deliveryMethod == null && order.delivery_method === 'delivery') ? 'delivery' : 'pickup',
    address: String(address ?? order.address ?? '').trim() || null,
    city: String(city ?? order.city ?? '').trim() || null,
    postal: String(postal ?? order.postal ?? '').trim() || null
  };
  if (!next.email || !next.email.includes('@')) throw new Error('The customer email must be a valid address.');
  if (next.deliveryMethod === 'delivery' && (!next.address || !next.city || !next.postal)) {
    throw new Error('Delivery needs a street address, city, and postal code.');
  }

  // If the email changed, re-link (or unlink) the customer account match.
  let userId = order.user_id;
  if (next.email !== String(order.email || '').toLowerCase()) {
    const { rows } = await query('SELECT id FROM users WHERE lower(email) = $1 LIMIT 1', [next.email]);
    userId = rows[0]?.id || null;
  }

  const { rows } = await query(
    `UPDATE orders SET name=$2, email=$3, phone=$4, delivery_method=$5, address=$6, city=$7, postal=$8, user_id=$9
      WHERE id=$1 RETURNING *`,
    [order.id, next.name, next.email, next.phone, next.deliveryMethod, next.address, next.city, next.postal, userId]
  );

  upsertCustomer({ email: next.email, name: next.name, phone: next.phone, address: next.address, city: next.city, postal: next.postal, userId })
    .catch((e) => console.error('customer upsert failed', e.message));
  return rows[0];
}

// Replace an order's line items (add/remove/reprice) with inventory kept
// honest: on a PAID order removed units relist and added units are marked sold;
// on a pending order the reservations are adjusted instead. Totals recompute
// preserving the order's delivery fee and whether it charged HST. Refused for
// invoice-bridged orders (edit the invoice — it syncs its order) and for
// cancelled/refunded ones.
// items: [{ sku?, title, price, cost? }] — sku present = inventory unit line.
export async function updateOrderItems(idOrNumber, items) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureOrderEditSchema();
  const { order, items: oldItems } = await loadOrder(idOrNumber);

  if (['cancelled', 'refunded'].includes(order.status)) {
    throw new Error(`A ${order.status} order can't be edited.`);
  }
  const inv = await orderInvoiceLink(order.id);
  if (inv) {
    throw new Error(`${order.order_number} was created from invoice ${inv.number} — edit that invoice instead so the books stay in sync.`);
  }

  const lines = (items || [])
    .map((it) => ({
      sku: String(it.sku || '').trim() || null,
      title: String(it.title || '').trim().slice(0, 500),
      price: round2(Number(it.price)),
      cost: Number.isFinite(Number(it.cost)) && Number(it.cost) >= 0 ? round2(Number(it.cost)) : null
    }))
    .filter((li) => li.title && li.price >= 0);
  if (!lines.length) throw new Error('An order needs at least one line item.');
  const newSkus = lines.map((l) => l.sku).filter(Boolean);
  if (new Set(newSkus).size !== newSkus.length) throw new Error('Each unit can only appear once on an order.');

  const oldSkus = [...new Set(oldItems.map((it) => it.sku).filter(Boolean))];
  const added = newSkus.filter((s) => !oldSkus.includes(s));
  const removed = oldSkus.filter((s) => !newSkus.includes(s));

  // Any newly added unit must be genuinely in stock and not held elsewhere.
  if (added.length) {
    const found = new Set((await getMany(added)).map((u) => u.id));
    const missing = added.filter((s) => !found.has(s));
    if (missing.length) throw new Error(`Not in live inventory: ${missing.join(', ')}. Pick an active unit (or sync inventory first).`);
    const blocked = await unavailableSkus(added);
    if (blocked.size) throw new Error(`Already sold or held by another order: ${[...blocked].join(', ')}.`);
  }

  // Totals: keep the existing delivery fee and the order's HST treatment, and
  // recompute around the new lines. The fee isn't stored, so it's what's left of
  // the total once goods, promo discount and tax are accounted for — leave the
  // discount out and a promo order's fee comes back short by the discount.
  const discount = round2(Number(order.discount) || 0);
  const fee = Math.max(0, round2(Number(order.total) - Number(order.subtotal) + discount - Number(order.hst)));
  const hasHst = Number(order.hst) > 0;
  const subtotal = round2(lines.reduce((a, l) => a + l.price, 0));
  const discounted = round2(Math.max(0, subtotal - discount));
  const hst = hasHst ? round2((discounted + fee) * HST_RATE) : 0;
  const total = round2(discounted + fee + hst);
  const paid = PAID_STATUSES.includes(order.status);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM order_items WHERE order_id = $1', [order.id]);
    for (const l of lines) {
      await client.query(
        'INSERT INTO order_items (order_id, sku, title, price, cost) VALUES ($1,$2,$3,$4,$5)',
        [order.id, l.sku, l.title, l.price, l.cost]
      );
    }
    await client.query(
      `UPDATE orders SET subtotal=$2, hst=$3, total=$4,
              notes = COALESCE(notes || E'\\n', '') || $5
        WHERE id=$1`,
      [order.id, subtotal, hst, total, `Items edited ${torontoToday()}`]
    );
    if (!paid) {
      // Pending order: swap the holds. Adding races other checkouts, so the
      // race-safe reserve runs inside this transaction (throws SKU_HELD → rollback).
      if (removed.length) {
        await client.query('DELETE FROM reservations WHERE order_id = $1 AND sku = ANY($2)', [order.id, removed]);
      }
      if (added.length) await reserveWithClient(client, added, order.id, OFFLINE_HOLD_MINUTES);
    }
  });

  // Paid order: settle the sold ledger (post-txn, best-effort like the other
  // sale paths — markUnitsSold is idempotent and tracker write-back is inside it).
  let relisted = 0, soldAdded = 0;
  if (paid) {
    try { relisted = await relistSkus(removed); } catch (e) { console.error('order edit relist failed', e.message); }
    try {
      if (added.length) {
        const prices = Object.fromEntries(lines.filter((l) => l.sku).map((l) => [l.sku, l.price]));
        soldAdded = (await markUnitsSold(added, { channel: 'order', ref: order.order_number, prices })).sold;
      }
    } catch (e) { console.error('order edit mark-sold failed', e.message); }
  }

  return { orderNumber: order.order_number, subtotal, hst, total, added, removed, relisted, soldAdded };
}

// Refund a PAID storefront order, fully (no skus) or per-unit (skus). Refunded
// units relist; a full refund flips the order to 'refunded' (drops out of all
// revenue), a partial removes those lines and shrinks the totals — mirroring
// the invoice refund flows. Invoice-bridged orders must refund via the invoice.
export async function refundOrder(idOrNumber, { skus = [] } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureOrderEditSchema();
  const { order, items } = await loadOrder(idOrNumber);

  const inv = await orderInvoiceLink(order.id);
  if (inv) throw new Error(`${order.order_number} was created from invoice ${inv.number} — refund that invoice instead (it cancels/adjusts this order itself).`);
  if (order.status === 'refunded') return { orderNumber: order.order_number, status: 'refunded', refundAmount: 0, relisted: 0, alreadyRefunded: true };
  if (order.status === 'cancelled') throw new Error(`${order.order_number} is cancelled — nothing to refund.`);
  if (!PAID_STATUSES.includes(order.status)) {
    throw new Error(`${order.order_number} hasn't been paid (${order.status}) — cancel it instead of refunding.`);
  }

  const want = [...new Set((skus || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))];
  const unitItems = items.filter((it) => it.sku);
  const targets = want.length ? items.filter((it) => it.sku && want.includes(it.sku.toLowerCase())) : items;
  if (want.length && !targets.length) throw new Error('None of those SKUs are on this order.');

  // Full refund: everything selected (or nothing specified).
  if (!want.length || targets.length === items.length) {
    const refundAmount = round2(Number(order.total) - Number(order.refund_total || 0));
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET status='refunded', refunded_at=now(), refund_total=total,
                notes = COALESCE(notes || E'\\n', '') || $2
          WHERE id=$1`,
        [order.id, `Refunded in full ${torontoToday()}`]
      );
      await client.query('DELETE FROM reservations WHERE order_id = $1', [order.id]);
    });
    let relisted = 0;
    try { relisted = await relistSkus(unitItems.map((it) => it.sku)); } catch (e) { console.error('order refund relist failed', e.message); }
    await mirrorOrderToWebInvoice(order.id, 'refunded');
    return { orderNumber: order.order_number, status: 'refunded', refundAmount, relisted, fullyRefunded: true };
  }

  // Partial: remove the refunded lines and take their money (plus HST share,
  // when the order charged HST) off the order.
  const hasHst = Number(order.hst) > 0;
  const refundBase = round2(targets.reduce((a, it) => a + (Number(it.price) || 0), 0));
  const refundHst = hasHst ? round2(refundBase * HST_RATE) : 0;
  const refundAmount = round2(refundBase + refundHst);
  const targetIds = targets.map((it) => it.id);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM order_items WHERE id = ANY($1)', [targetIds]);
    await client.query(
      `UPDATE orders SET
         subtotal = GREATEST(0, round((subtotal - $2)::numeric, 2)),
         hst      = GREATEST(0, round((hst - $3)::numeric, 2)),
         total    = GREATEST(0, round((total - $4)::numeric, 2)),
         refund_total = round((COALESCE(refund_total,0) + $4)::numeric, 2),
         notes    = COALESCE(notes || E'\\n', '') || $5
       WHERE id = $1`,
      [order.id, refundBase, refundHst, refundAmount,
       `Partial refund ${torontoToday()}: ${targets.map((t) => t.title).join(', ')} (−$${refundAmount.toFixed(2)})`]
    );
    await client.query('DELETE FROM reservations WHERE order_id = $1 AND sku = ANY($2)', [order.id, targets.map((t) => t.sku)]);
  });
  let relisted = 0;
  try { relisted = await relistSkus(targets.map((it) => it.sku)); } catch (e) { console.error('order refund relist failed', e.message); }
  return { orderNumber: order.order_number, status: order.status, refundAmount, relisted, fullyRefunded: false, refundedItems: targets.length };
}
