import { NextResponse } from 'next/server';
import { sendDayReport } from '../../../../lib/manager-report';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// The end-of-day report (owner, 2026-11-17): everything the Manager and its two
// department managers did today, plus what needs him. 01:00 UTC = 8pm EST / 9pm EDT.
// `?dry=1` builds it without sending.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await sendDayReport({ dry });
    return NextResponse.json({ ok: r.ok, actions: r.actions.length, needsYou: r.needsYou.length, dry }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error('cron manager-report failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('manager-report', run);
export const GET = beat;
export const POST = beat;
