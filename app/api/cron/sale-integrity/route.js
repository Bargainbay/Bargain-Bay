import { NextResponse } from 'next/server';
import { runSaleIntegrity } from '../../../../lib/sale-integrity';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every 20 minutes: anything with money paid is Sold on the tracker, and every
// sold unit has a cost. Fixes what it can, proves it, and tells the owner the rest.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await runSaleIntegrity();
    // Problems left over are a failed run, so the daily health email says so too.
    return NextResponse.json({ ok: !r.problems?.length, ...r }, { status: r.problems?.length ? 502 : 200 });
  } catch (e) {
    console.error('sale integrity failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
const beat = withHeartbeat('sale-integrity', run);
export const GET = beat;
export const POST = beat;
