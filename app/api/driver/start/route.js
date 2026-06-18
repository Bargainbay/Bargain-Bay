import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { isDriver, orderBelongsToDriver } from '../../../../lib/drivers';
import { updateOrderStatus } from '../../../../lib/orders';
import { markUnitsSold } from '../../../../lib/catalog-sync';
import { sendOrderStatusEmail } from '../../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Driver taps "Start delivery" → order flips to out_for_delivery and the
// customer gets the "on the way" email. Only the assigned driver can do this.
export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  if (!(await isDriver(s))) return NextResponse.json({ error: 'Not a driver account' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const orderId = Number(body.orderId);
  if (!orderId) return NextResponse.json({ error: 'orderId is required.' }, { status: 400 });
  if (!(await orderBelongsToDriver(orderId, s.userId))) {
    return NextResponse.json({ error: 'That delivery is not assigned to you.' }, { status: 403 });
  }

  try {
    const order = await updateOrderStatus(orderId, 'out_for_delivery');
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const { rows: its } = await query('SELECT sku, title, price FROM order_items WHERE order_id = $1', [orderId]);
    // Payment is in by this point; keep the sold ledger consistent (idempotent).
    try { await markUnitsSold(its.map((r) => r.sku), { channel: 'order', ref: order.order_number, price: null }); } catch (e) { console.error('markUnitsSold (driver start) failed', e.message); }
    sendOrderStatusEmail(order, its.map((r) => ({ title: r.title, price: Number(r.price) })))
      .catch((e) => console.error('out-for-delivery email failed', e.message));
    return NextResponse.json({ ok: true, status: 'out_for_delivery' });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not start delivery' }, { status: 500 });
  }
}
