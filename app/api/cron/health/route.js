import { NextResponse } from 'next/server';
import { runHealth } from '../../../../lib/health';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily: one email saying whether the scheduled jobs, error reporting and
// off-site backups are healthy. `?email=0` runs the checks without sending.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const email = new URL(req.url).searchParams.get('email') !== '0';
    return NextResponse.json(await runHealth({ email }));
  } catch (e) {
    console.error('cron health failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('health', run);
export const GET = beat;
export const POST = beat;
