import { NextResponse } from 'next/server';
import { runAdSync } from '../../../../lib/cron-jobs';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Meta ad-spend sync, on its own. No longer scheduled by itself —
// /api/cron/nightly runs it — but kept for triggering by hand. No-ops cleanly
// until META_ADS_ACCESS_TOKEN + META_AD_ACCOUNT_ID are configured.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runAdSync()) });
  } catch (e) {
    console.error('cron sync-ads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('sync-ads', run);
export const GET = beat;
export const POST = beat;
