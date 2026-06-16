import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../lib/db';
import { getOrderByCloverSession } from '../../../lib/orders';
import { writebackEnabled, writeSold } from '../../../lib/sheets';
import { sendOrderEmails } from '../../../lib/email';

export const dynamic = 'force-dynamic';

// Reject forged webhooks. This endpoint can mark an order PAID, so it must not
// accept anonymous POSTs. Set CLOVER_WEBHOOK_SECRET in the env and register the
// webhook URL in Clover with the same secret as a query string, e.g.
//   https://bargainbay.ca/api/clover-webhook?key=<CLOVER_WEBHOOK_SECRET>
// (Clover calls the exact URL you register, so the secret rides along.) A
// matching `x-webhook-secret` header is also accepted. When no secret is set
// the guard is skipped so pay-on-pickup / sandbox keep working unchanged.
// NOTE: for full integrity, also verify Clover's HMAC signature header once the
// exact scheme is confirmed in your Clover dashboard.
function webhookAuthorized(req) {
  const secret = process.env.CLOVER_WEBHOOK_SECRET;
  if (!secret) return true; // not yet configured — don't break existing flow
  let key = req.headers.get('x-webhook-secret');
  if (!key) { try { key = new URL(req.url).searchParams.get('key'); } catch { key = null; } }
  return key === secret;
}

// Clover calls this after a hosted-checkout session completes. Configure the
// webhook URL in the Clover dashboard: https://<your-domain>/api/clover-webhook
// On payment success: order -> confirmed, and (when SHEET_WRITEBACK=1) the
// master tracker learns about the sale via writeSold (best-effort; sheet
// errors NEVER fail the webhook).
export async function POST(req) {
  if (!webhookAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
        const { rows: orderItems } = await query(
          'SELECT sku, title, price FROM order_items WHERE order_id = $1', [order.id]
        );
        // Tell the master sheet — guarded and best-effort.
        if (writebackEnabled()) {
          for (const it of orderItems) {
            try { await writeSold(it.sku, Number(it.price)); }
            catch (e) { console.error('writeSold failed for', it.sku, e.message); }
          }
        }
        // Customer receipt + owner alert (best-effort; never fails the webhook).
        sendOrderEmails(
          {
            orderNumber: order.order_number, name: order.name, email: order.email,
            deliveryMethod: order.delivery_method, address: order.address, city: order.city,
            postal: order.postal, subtotal: order.subtotal, hst: order.hst, total: order.total
          },
          orderItems.map((it) => ({ title: it.title, price: Number(it.price) }))
        ).catch((e) => console.error('order emails failed', e.message));
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
