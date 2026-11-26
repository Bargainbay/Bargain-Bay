import { NextResponse } from 'next/server';
import { sendPaidPurchases } from '../../../../lib/meta-purchases';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every 10 minutes: tell Meta about website orders that have now been paid.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await sendPaidPurchases();
    const error = r.error || r.failed?.[0]?.error || null;
    // A refused send is a failed run, so the daily health email says so.
    return NextResponse.json({ ok: !error, ...r, ...(error ? { error } : {}) }, { status: error ? 502 : 200 });
  } catch (e) {
    console.error('meta purchases failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
const beat = withHeartbeat('meta-purchases', run);
export const GET = beat;
export const POST = beat;
