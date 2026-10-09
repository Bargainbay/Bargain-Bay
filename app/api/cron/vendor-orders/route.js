import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { sweepVendorOrders } from '../../../../lib/vendor-orders';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The marketplace's deadline sweep: lapses orders a seller did not accept in 24 hours, strikes the ones
// not ready in 72, and sends the reminders. Its own schedule (see vercel.json) rather than part of the
// nightly pass, because a 24-hour deadline checked once a day would be up to a day late.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ ok: false, error: 'POSTGRES_URL is not set.' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await sweepVendorOrders()) });
  } catch (e) {
    console.error('vendor-orders sweep failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
