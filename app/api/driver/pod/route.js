import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { isDriver, orderBelongsToDriver } from '../../../../lib/drivers';
import { updateOrderStatus } from '../../../../lib/orders';
import { markUnitsSold } from '../../../../lib/catalog-sync';
import { sendOrderStatusEmail } from '../../../../lib/email';
import { addPodPhoto, setSignaturePath } from '../../../../lib/pod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Driver completes a delivery: uploads a signed signature (+ optional photos) to
// the private Blob store, then the order auto-flips to Delivered and the customer
// gets the "Order Delivered!" email.
export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  if (!(await isDriver(s))) return NextResponse.json({ error: 'Not a driver account' }, { status: 403 });

  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }); }
  const orderId = Number(form.get('orderId'));
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  if (!(await orderBelongsToDriver(orderId, s.userId))) {
    return NextResponse.json({ error: 'That delivery is not assigned to you.' }, { status: 403 });
  }

  const { rows: ord } = await query('SELECT id, order_number, status FROM orders WHERE id = $1', [orderId]);
  const order0 = ord[0];
  if (!order0) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order0.status !== 'out_for_delivery') {
    return NextResponse.json({ error: 'Start the delivery before completing it.' }, { status: 409 });
  }

  const signature = form.get('signature');
  const photos = form.getAll('photos').filter((f) => f && typeof f === 'object' && f.size > 0);
  if (!signature || typeof signature !== 'object' || !signature.size) {
    return NextResponse.json({ error: 'A signature is required to complete the delivery.' }, { status: 400 });
  }

  try {
    const base = `pod/${order0.order_number}`;
    const sig = await put(`${base}/signature.png`, signature, { access: 'private', addRandomSuffix: true, contentType: 'image/png' });
    await setSignaturePath(orderId, sig.pathname);

    for (let i = 0; i < photos.length && i < 8; i++) {
      const p = photos[i];
      const r = await put(`${base}/photo-${i}.jpg`, p, { access: 'private', addRandomSuffix: true, contentType: p.type || 'image/jpeg' });
      await addPodPhoto(orderId, r.url, r.pathname);
    }

    const order = await updateOrderStatus(orderId, 'delivered');
    await query('UPDATE orders SET delivered_at = now() WHERE id = $1', [orderId]);
    const { rows: its } = await query('SELECT sku, title, price FROM order_items WHERE order_id = $1', [orderId]);
    try {
      const prices = Object.fromEntries(its.map((r) => [r.sku, Number(r.price) || null]));
      await markUnitsSold(its.map((r) => r.sku), { channel: 'order', ref: order.order_number, prices });
    } catch (e) { console.error('markUnitsSold (pod) failed', e.message); }
    sendOrderStatusEmail({ ...order, status: 'delivered' }, its.map((r) => ({ title: r.title, price: Number(r.price) })))
      .catch((e) => console.error('delivered email failed', e.message));

    return NextResponse.json({ ok: true, status: 'delivered', photos: photos.length });
  } catch (e) {
    console.error('POD upload failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 });
  }
}
