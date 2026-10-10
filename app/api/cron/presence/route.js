import { NextResponse } from 'next/server';
import { runPresenceCheck } from '../../../../lib/work-presence';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every ten minutes overnight (UTC covers both sides of the daylight-saving
// change; the job decides for itself whether it is evening in Toronto). Asks
// anyone clocked in "still working?", and rings the owner's WhatsApp when a
// question has gone two hours unanswered.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await runPresenceCheck({ force: new URL(req.url).searchParams.get('force') === '1' });
    // A WhatsApp that did not go out is a failed run, so the daily health email
    // says so: the ping is the whole point of this job.
    return NextResponse.json({ ok: !r.failed?.length, ...r }, { status: r.failed?.length ? 502 : 200 });
  } catch (e) {
    console.error('presence check failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
const beat = withHeartbeat('presence', run);
export const GET = beat;
export const POST = beat;
