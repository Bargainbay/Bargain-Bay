import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { ORDER_STATUSES, updateOrderStatus } from '../../../../lib/orders';

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
    return NextResponse.json({ order });
  } catch (e) {
    console.error('admin status update failed', e);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
