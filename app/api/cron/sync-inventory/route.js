import { NextResponse } from 'next/server';
import { runNightlyOps } from '../../../../lib/cron-jobs';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The finance + inventory pass, on its own. No longer scheduled by itself —
// /api/cron/nightly runs it — but kept for triggering by hand after a tracker
// edit, or to force a QuickBooks / bank pull without waiting for tonight.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runNightlyOps()) });
  } catch (e) {
    console.error('cron sync-inventory failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
