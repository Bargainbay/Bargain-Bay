import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db';
import { getOrderByNumber } from '../../../lib/orders';
import { getSession } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// Lightweight status poll for the live order tracker. Access matches the order
// page: logged-in owner, session email, or the guest email the order was placed
// under. Returns only the fields the tracker needs.
export async function GET(req) {
  if (!hasDb()) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  const u = new URL(req.url);
  const number = u.searchParams.get('number');
  const email = (u.searchParams.get('email') || '').trim().toLowerCase();
  if (!number) return NextResponse.json({ error: 'number required' }, { status: 400 });

  const order = await getOrderByNumber(number).catch(() => null);
  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const session = await getSession();
  const ok =
    (session && order.user_id && session.userId === order.user_id) ||
    (session && session.email?.toLowerCase() === order.email?.toLowerCase()) ||
    (email && email === order.email?.toLowerCase());
  if (!ok) return NextResponse.json({ error: 'denied' }, { status: 403 });

  return NextResponse.json({ status: order.status });
}
