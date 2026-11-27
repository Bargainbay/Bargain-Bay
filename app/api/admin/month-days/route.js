// Sales per day for whole months (the month chart and its comparisons). Staff see
// sales and revenue; gross profit is computed for and sent to an admin only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { monthDays } from '../../../../lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(s && isStaff(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const months = (new URL(req.url).searchParams.get('months') || '').split(',').filter(Boolean);
  try {
    const data = await monthDays(months, { profit: isAdmin(s) });
    if (!data) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 400 });
  }
}
