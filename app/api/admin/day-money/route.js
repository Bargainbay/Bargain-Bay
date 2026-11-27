// Net profit and restock money by day, or one day's sales in full. Admin only:
// everything here is built from costs and wages.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { dayMoney } from '../../../../lib/day-money';
import { ordersOnDay } from '../../../../lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const q = new URL(req.url).searchParams;
  try {
    const day = q.get('day');
    if (day) return NextResponse.json({ day, orders: await ordersOnDay(day) });
    const data = await dayMoney({ from: q.get('from'), to: q.get('to') });
    if (!data) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 400 });
  }
}
