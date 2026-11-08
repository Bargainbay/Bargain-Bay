// The rep's shop clock: clock in when you start the day at the shop, clock out when you leave.
// A day with a shop clock-in is an In-house Day. Identity is the session, never the body.
import { NextResponse } from 'next/server';
import { requireHub } from '../../../../lib/sales-access';
import { openShift, clockIn, clockOut, recentShifts, CommissionError } from '../../../../lib/sales-commission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof CommissionError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  console.error('sales clock failed', e.message);
  return NextResponse.json({ error: 'That did not work.' }, { status: 500 });
};

export async function GET() {
  const v = await requireHub();
  if (!v) return deny();
  return NextResponse.json({ open: await openShift(v.email), recent: await recentShifts(v.email, 14) });
}

export async function POST(req) {
  const v = await requireHub();
  if (!v) return deny();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'in') return NextResponse.json({ ok: true, shift: await clockIn(v.email) });
    if (body.action === 'out') return NextResponse.json({ ok: true, shift: await clockOut(v.email) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return fail(e); }
}
