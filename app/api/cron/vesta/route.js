import { NextResponse } from 'next/server';
import { syncVesta } from '../../../../lib/vesta';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Daily mirror of Vesta Kitchen's public catalogue into vesta_products.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await syncVesta()) });
  } catch (e) {
    console.error('vesta sync failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 502 });
  }
}
const beat = withHeartbeat('vesta', run);
export const GET = beat;
export const POST = beat;
