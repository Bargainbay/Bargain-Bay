import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { assignDelivery } from '../../../../lib/drivers';

export const dynamic = 'force-dynamic';

// Assign a delivery date + driver to a delivery order. body: { orderId, deliveryDate, driverId }
export async function POST(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const orderId = Number(body.orderId);
  if (!orderId) return NextResponse.json({ error: 'orderId is required.' }, { status: 400 });
  const deliveryDate = body.deliveryDate ? String(body.deliveryDate).slice(0, 10) : null;
  const driverId = body.driverId ? Number(body.driverId) : null;
  if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
  }
  try {
    const order = await assignDelivery(orderId, { deliveryDate, driverId });
    if (!order) return NextResponse.json({ error: 'Order not found or not a delivery order.' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      order: { id: order.id, deliveryDate: order.delivery_date ? order.delivery_date.toISOString().slice(0, 10) : null, driverId: order.driver_id }
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Update failed' }, { status: 500 });
  }
}
