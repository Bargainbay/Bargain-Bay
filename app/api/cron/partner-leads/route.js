import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { remindUnclaimedLeads, notifyTeamOfNewLeads } from '../../../../lib/partner-leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Hourly: chase partner leads nobody has claimed in two hours, and send any "new leads" email a failed send left behind.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const notified = await notifyTeamOfNewLeads();
    const reminded = await remindUnclaimedLeads();
    return NextResponse.json({ ok: true, notified, reminded });
  } catch (e) {
    console.error('cron partner-leads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('partner-leads', run);
export const GET = beat;
export const POST = beat;
