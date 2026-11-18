// Everybody's hours (staff clock + driver shifts), any date range. Admin only:
// it carries pay rates and cost.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hoursReport, presetRange } from '../../../../lib/hours';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const range = presetRange(sp.get('range')) || { from: sp.get('from'), to: sp.get('to') };
  return NextResponse.json(await hoursReport(range));
}
