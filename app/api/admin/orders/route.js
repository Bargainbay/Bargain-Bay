import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { ORDER_STATUSES, updateOrderStatus } from '../../../../lib/orders';
import { markUnitsSold } from '../../../../lib/catalog-sync';

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
  if (!id || !ORDER_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid id or status' }, { status: 400 });
  }
  try {
    const order = await updateOrderStatus(id, status);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (status === 'cancelled') {
      await query('DELETE FROM reservations WHERE order_id = $1', [id]).catch(() => {});
    }
    // Confirming an order = payment received. Record its units in the sold ledger
    // (drops them off the storefront durably + onto the reconciliation list) and
    // release the long hold. Online card orders are marked sold by the webhook
    // instead, so this mainly covers offline e-transfer / pay-on-pickup orders.
    if (status === 'confirmed') {
      try {
        const { rows: its } = await query('SELECT sku FROM order_items WHERE order_id = $1', [id]);
        await markUnitsSold(its.map((r) => r.sku), { channel: 'order', ref: order.order_number, price: null });
        await query('DELETE FROM reservations WHERE order_id = $1', [id]).catch(() => {});
      } catch (e) {
        console.error('mark order confirmed -> sold failed', e.message);
      }
    }
    return NextResponse.json({ order });
  } catch (e) {
    console.error('admin status update failed', e);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
