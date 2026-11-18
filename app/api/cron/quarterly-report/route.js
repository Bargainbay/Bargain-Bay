import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { sendReportWhenReady } from '../../../../lib/pnl-email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// quarterly: the Daily P&L table, mailed to the office. `?dry=1` builds it and sends nothing.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await sendReportWhenReady({ kind: 'quarterly', send: !dry, force: dry });
    if (r.action === 'send' && r.sent && r.sent.ok === false && !r.sent.skipped) return NextResponse.json({ ok: false, ...r }, { status: 502 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('quarterly-report failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const beat = withHeartbeat('quarterly-report', run);
export const GET = beat;
export const POST = beat;
