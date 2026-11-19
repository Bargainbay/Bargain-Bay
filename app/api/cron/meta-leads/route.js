import { NextResponse } from 'next/server';
import { runMetaLeadPull } from '../../../../lib/meta-leads';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every 15 minutes: bring new Meta Instant Form leads onto their boards (RS Solutions workshop Board,
// or the Sales Hub lead board). `?dry=1` reads and counts without writing. A pass that could not deliver a
// lead answers 502 so the heartbeat and the daily health email say so; an unset token is reported by the
// Manager (lib/manager-business.js) rather than failing every run.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await runMetaLeadPull({ dry });
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error('cron meta-leads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('meta-leads', run);
export const GET = beat;
export const POST = beat;
