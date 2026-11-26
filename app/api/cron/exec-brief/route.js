import { NextResponse } from 'next/server';
import { runExecPass } from '../../../../lib/exec';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

// Every half hour through the day: the first pass from 7am Toronto reviews the
// business and emails the owner the morning brief; later passes give people their
// target once they clock in and push them every 2-3 hours until 8pm (both are
// switches on the Manager page). `?dry=1` builds
// the brief without writing a target or sending anything.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await runExecPass({ dry });
    return NextResponse.json(r);
  } catch (e) {
    console.error('cron exec-brief failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('exec-brief', run);
export const GET = beat;
export const POST = beat;
