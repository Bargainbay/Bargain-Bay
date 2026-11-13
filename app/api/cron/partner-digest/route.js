import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { runPostingDigest } from '../../../../lib/partner-posting';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every evening: tell each lead generator which of their posted listings have sold and what is new, and each organisation's admins who
// still has sold listings up. Scheduled twice (an hour and a half apart) because the second run only retries what failed: each
// recipient's row for the day is claimed before sending. `?dry=1` counts without sending or recording anything.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await runPostingDigest({ dryRun: new URL(req.url).searchParams.get('dry') === '1' });
    // Stock that could not be read is reported as a failure so the health email names it; nobody was emailed.
    return NextResponse.json(r, { status: r.ok ? 200 : 503 });
  } catch (e) {
    console.error('cron partner-digest failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('partner-digest', run);
export const GET = beat;
export const POST = beat;
