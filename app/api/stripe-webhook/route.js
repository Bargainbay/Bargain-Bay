import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../lib/db';
import { getStripe } from '../../../lib/stripe';
import { getOrderByStripeSession } from '../../../lib/orders';
import { writebackEnabled, writeSold } from '../../../lib/sheets';
import { markUnitsSold } from '../../../lib/catalog-sync';
import { sendOrderEmails } from '../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Stripe calls this after a Checkout Session resolves. Configure the endpoint in
// the Stripe dashboard (Developers → Webhooks): https://bargainbay.ca/api/stripe-webhook
// listening for checkout.session.completed (+ async_payment_succeeded/failed,
// session.expired) AND invoice.paid (so a CRM invoice paid by card via its pay
// link delists its units — the out-of-band "Mark paid" path is handled in the
// admin API). The signing secret goes in STRIPE_WEBHOOK_SECRET.
//
// We REQUIRE a verified signature — an unsigned/forged POST can never mark an
// order paid (that was the big risk with the old unverified Clover webhook).
export async function POST(req) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const body = await req.text(); // RAW body required for signature verification

  if (!secret || !sig) {
    console.error('stripe webhook: missing STRIPE_WEBHOOK_SECRET or signature');
    return NextResponse.json({ error: 'webhook not configured' }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error('stripe webhook signature verification failed', e.message);
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  try {
    if (!hasDb()) return NextResponse.json({ received: true });
    const obj = event.data?.object || {};
    const sessionId = obj.id;
    const orderId = obj.metadata?.orderId ? Number(obj.metadata.orderId) : null;

    const findOrder = async () => {
      if (orderId) {
        const { rows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (rows.length) return rows[0];
      }
      return sessionId ? getOrderByStripeSession(String(sessionId)) : null;
    };

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
      const order = await findOrder();
      if (order && paid && order.status === 'pending_payment') {
        await query("UPDATE orders SET status = 'confirmed' WHERE id = $1", [order.id]);
        const { rows: orderItems } = await query('SELECT sku, title, price FROM order_items WHERE order_id = $1', [order.id]);
        // Record the sale in the local sold ledger so the units drop off the site
        // durably (survive tracker re-import) and show on the reconciliation list.
        try {
          await markUnitsSold(orderItems.map((it) => it.sku), { channel: 'order', ref: order.order_number, price: null });
        } catch (e) {
          console.error('markUnitsSold (order) failed', e.message);
        }
        if (writebackEnabled()) {
          for (const it of orderItems) {
            try { await writeSold(it.sku, Number(it.price)); }
            catch (e) { console.error('writeSold failed for', it.sku, e.message); }
          }
        }
        // map snake_case DB row → the camelCase shape the email builder expects
        sendOrderEmails(
          {
            orderNumber: order.order_number, name: order.name, email: order.email,
            deliveryMethod: order.delivery_method, address: order.address, city: order.city,
            postal: order.postal, subtotal: order.subtotal, hst: order.hst, total: order.total
          },
          orderItems.map((it) => ({ title: it.title, price: Number(it.price) }))
        ).catch((e) => console.error('order emails failed', e.message));
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const order = await findOrder();
      if (order && order.status === 'pending_payment') {
        await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
        await query('DELETE FROM reservations WHERE order_id = $1', [order.id]);
      }
    } else if (event.type === 'invoice.paid') {
      // A CRM invoice was paid. Covers the card-via-pay-link path (the cash/
      // e-transfer "Mark paid" path already delists in the admin API). The SKUs
      // were stashed on the invoice metadata at creation. Idempotent: re-firing
      // for an already-handled out-of-band payment is a harmless no-op.
      const skus = String(obj.metadata?.skus || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (skus.length) {
        try {
          await markUnitsSold(skus, { channel: 'invoice', ref: obj.number || obj.id, price: (obj.total || 0) / 100 });
        } catch (e) {
          console.error('markUnitsSold (invoice webhook) failed', e.message);
        }
      }
    }
  } catch (e) {
    console.error('stripe webhook error', e);
  }
  // Always 200 on internal errors so Stripe doesn't retry forever.
  return NextResponse.json({ received: true });
}
