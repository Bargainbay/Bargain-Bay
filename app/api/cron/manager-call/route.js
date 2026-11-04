import { NextResponse } from 'next/server';
import { runManagerPass } from '../../../../lib/manager-call';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Several times a day: scan the business, and ring the owner ONLY when something
// is worth a call, inside calling hours, and he has not already been reached today
// (lib/manager-rules.js shouldCallNow). `?dry=1` scans and decides without ringing.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await runManagerPass({ dry });
    // A call that was decided on and could not be placed is a failed run, so the
    // daily health email says so rather than leaving it in a log nobody reads.
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error('cron manager-call failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('manager-call', run);
export const GET = beat;
export const POST = beat;
