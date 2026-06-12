import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../lib/db';
import { getOrderByCloverSession } from '../../../lib/orders';
import { writebackEnabled, writeSold } from '../../../lib/sheets';

export const dynamic = 'force-dynamic';

// Clover calls this after a hosted-checkout session completes. Configure the
// webhook URL in the Clover dashboard: https://<your-domain>/api/clover-webhook
// On payment success: order -> confirmed, and (when SHEET_WRITEBACK=1) the
// master tracker learns about the sale via writeSold (best-effort; sheet
// errors NEVER fail the webhook).
// TODO before go-live: verify Clover's webhook signature header.
export async function POST(req) {
  let event;
  try { event = await req.json(); } catch { event = {}; }

  try {
    if (!hasDb()) return NextResponse.json({ received: true });

    const sessionId =
      event?.checkoutSessionId || event?.checkoutSession?.id || event?.sessionId || event?.id || null;
    const paid =
      event?.type === 'PAYMENT' || event?.status === 'PAID' ||
      event?.status === 'APPROVED' || event?.paid === true;
    const failed = event?.status === 'FAILED' || event?.status === 'CANCELLED';

    let order = sessionId ? await getOrderByCloverSession(String(sessionId)) : null;

    // Fallback: match by SKUs embedded in line-item notes.
    if (!order) {
      const skus = (event?.shoppingCart?.lineItems || event?.lineItems || [])
        .map((li) => li.note)
        .filter((n) => n && n !== 'HST' && n !== 'DELIVERY');
      if (skus.length) {
        const { rows } = await query(
          `SELECT o.* FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
            WHERE oi.sku = ANY($1) AND o.status = 'pending_payment'
            ORDER BY o.created_at DESC LIMIT 1`,
          [skus]
        );
        if (rows.length) order = rows[0];
      }
    }

    if (order) {
      if (paid && order.status === 'pending_payment') {
        await query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [order.id]);
        // Tell the master sheet — guarded and best-effort.
        if (writebackEnabled()) {
          const { rows: orderItems } = await query(
            'SELECT sku, price FROM order_items WHERE order_id = $1', [order.id]
          );
          for (const it of orderItems) {
            try { await writeSold(it.sku, Number(it.price)); }
            catch (e) { console.error('writeSold failed for', it.sku, e.message); }
          }
        }
      } else if (failed && order.status === 'pending_payment') {
        await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
        await query('DELETE FROM reservations WHERE order_id = $1', [order.id]);
      }
    }
  } catch (e) {
    console.error('clover webhook error', e);
  }
  // Always 200 so Clover doesn't retry forever on our internal errors.
  return NextResponse.json({ received: true });
}
