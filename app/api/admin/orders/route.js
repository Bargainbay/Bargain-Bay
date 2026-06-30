import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { ORDER_STATUSES, updateOrderStatus } from '../../../../lib/orders';
import { markUnitsSold } from '../../../../lib/catalog-sync';
import { sendOrderStatusEmail } from '../../../../lib/email';

export const dynamic = 'force-dynamic';

export async function PATCH(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = Number(body.id);
  const status = String(body.status || '');
  const notify = body.notify !== false; // default true; false = change status without emailing the customer
  if (!id || !ORDER_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid id or status' }, { status: 400 });
  }
  try {
    const order = await updateOrderStatus(id, status);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const { rows: its } = await query('SELECT sku, title, price FROM order_items WHERE order_id = $1', [id]);

    if (status === 'cancelled') {
      await query('DELETE FROM reservations WHERE order_id = $1', [id]).catch(() => {});
    }
    // Moving an order past pending_payment = payment received. Record its units
    // in the sold ledger (drops them off the storefront durably + onto the
    // reconciliation list) and release the long hold. markUnitsSold is idempotent,
    // so re-firing on later status changes is harmless. Online card orders are
    // marked sold by the webhook; this covers offline e-transfer / pay-on-pickup.
    if (['confirmed', 'ready', 'out_for_delivery', 'delivered'].includes(status)) {
      try {
        const prices = Object.fromEntries(its.map((r) => [r.sku, Number(r.price) || null]));
        await markUnitsSold(its.map((r) => r.sku), { channel: 'order', ref: order.order_number, prices });
        await query('DELETE FROM reservations WHERE order_id = $1', [id]).catch(() => {});
      } catch (e) {
        console.error('mark order confirmed -> sold failed', e.message);
      }
    }
    // Email the customer about the status change (best-effort; never blocks),
    // unless the owner chose to do it silently (e.g. a quiet in-person payment).
    if (notify) {
      sendOrderStatusEmail(order, its.map((r) => ({ title: r.title, price: Number(r.price) })))
        .catch((e) => console.error('order status email failed', e.message));
    }
    return NextResponse.json({ order });
  } catch (e) {
    console.error('admin status update failed', e);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
