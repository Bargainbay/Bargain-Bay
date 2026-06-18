import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../lib/db';
import { getSession } from '../../../lib/auth';
import { getOrderByNumber } from '../../../lib/orders';
import { availableSlots, isValidSlotFormat } from '../../../lib/pickup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Order is accessible if: logged-in owner, session email match, or the guest
// supplied the email the order was placed under (same rule as the order page).
async function ownedOrder(orderNumber, email) {
  const order = await getOrderByNumber(orderNumber).catch(() => null);
  if (!order) return null;
  const session = await getSession();
  const ok =
    (session && order.user_id && session.userId === order.user_id) ||
    (session && session.email?.toLowerCase() === order.email?.toLowerCase()) ||
    (email && email === order.email?.toLowerCase());
  return ok ? order : null;
}

export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const orderNumber = String(body.orderNumber || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const slot = String(body.slot || '').trim();

  const order = await ownedOrder(orderNumber, email);
  if (!order) return NextResponse.json({ error: 'Order not found or access denied.' }, { status: 403 });
  if (order.delivery_method !== 'pickup') return NextResponse.json({ error: 'This order is for delivery, not pickup.' }, { status: 400 });
  if (order.status !== 'ready') return NextResponse.json({ error: 'Pickup booking opens once your order is marked ready.' }, { status: 409 });
  if (!isValidSlotFormat(slot)) return NextResponse.json({ error: 'Pick a valid time slot.' }, { status: 400 });

  // Confirm the slot is still offered (not in the past, not taken by another order).
  const avail = await availableSlots();
  if (!avail.some((s) => s.value === slot)) {
    return NextResponse.json({ error: 'That time was just taken — please pick another.' }, { status: 409 });
  }

  await query('UPDATE orders SET pickup_slot = $2 WHERE id = $1', [order.id, slot]);
  return NextResponse.json({ ok: true, slot });
}
