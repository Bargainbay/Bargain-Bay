// Daily sales per rep for the trend/comparison charts. Staff — the same people
// who can already see the scorecard it extends; pre-tax revenue only, no costs.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { repDaily } from '../../../../lib/analytics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(s && isStaff(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const u = new URL(req.url);
  try {
    const data = await repDaily({ from: u.searchParams.get('from') || undefined, to: u.searchParams.get('to') || undefined });
    if (!data) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 400 });
  }
}
