// Keeping a storefront sale's invoice in step with its order.
//
// Deliberately its own module with NOTHING but a db import. lib/invoices.js
// imports lib/orders.js, so having orders.js (and reservations.js) import these
// helpers from invoices.js created an import cycle straight through the checkout
// path — the kind that resolves fine until a bundler orders the modules
// differently and a function is undefined at call time.
//
// No schema provisioning here either: these only ever match rows that
// createAndSendInvoice already wrote, so ensureInvoiceSchema has run by then.
import { hasDb, query } from './db';

// ── Web sales: the ORDER leads, the invoice follows ─────────────────────────
// A storefront checkout owns its own lifecycle — it reserves units, gets
// confirmed when the money lands, auto-cancels if abandoned, refunds through
// refundOrder(). Its invoice exists to give that sale an INV- number, a proper
// document and a place in the invoice ledger; it must NOT become a second source
// of truth, or the two records drift.
//
// So this mirrors the order's status onto the invoice and does nothing else: no
// emails (checkout already sends its own, with the same payment box), no unit
// delisting (the order flow owns stock), and no writes back to orders (which
// would loop). Only 'web' invoices are touched — a manual invoice DRIVES its
// order and must never be overwritten by it.
const ORDER_TO_INVOICE_STATUS = {
  pending_payment: 'open',
  confirmed: 'paid',
  ready: 'paid',
  out_for_delivery: 'paid',
  delivered: 'paid',
  cancelled: 'void',
  refunded: 'refunded'
};

export async function mirrorOrderToWebInvoice(orderId, orderStatus) {
  if (!hasDb() || !orderId) return { mirrored: false };
  const next = ORDER_TO_INVOICE_STATUS[orderStatus];
  if (!next) return { mirrored: false };
  try {
    // A partly-paid web invoice keeps its 'partial' status while the order is
    // still pending — a deposit recorded by hand shouldn't be flattened to 'open'.
    const { rows } = await query(
      `UPDATE invoices SET
         status = $2,
         paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
         payment_method = CASE WHEN $2 = 'paid'
                               THEN COALESCE(payment_method, (SELECT o.payment_method FROM orders o WHERE o.id = $1))
                               ELSE payment_method END
       WHERE order_id = $1
         AND channel = 'web'
         AND status <> $2
         AND NOT ($2 = 'open' AND status = 'partial')
       RETURNING id, number`,
      [orderId, next]
    );
    return { mirrored: rows.length > 0, number: rows[0]?.number || null, status: next };
  } catch (e) {
    console.error('mirrorOrderToWebInvoice failed', e.message);
    return { mirrored: false };
  }
}

// Void the web invoices behind a set of orders — used by the sweep that cancels
// abandoned checkouts, so the sale stops showing as an open receivable the moment
// its order is cancelled.
export async function voidWebInvoicesForOrders(orderIds = []) {
  const ids = (orderIds || []).map((n) => Number(n)).filter(Number.isFinite);
  if (!hasDb() || !ids.length) return 0;
  try {
    const { rowCount } = await query(
      `UPDATE invoices SET status = 'void'
        WHERE order_id = ANY($1) AND channel = 'web' AND status IN ('open','partial')`,
      [ids]
    );
    return rowCount || 0;
  } catch (e) {
    console.error('voidWebInvoicesForOrders failed', e.message);
    return 0;
  }
}

