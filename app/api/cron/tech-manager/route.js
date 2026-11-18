import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { runTechManager } from '../../../../lib/tech-manager';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every 30 minutes: the Tech Manager's nudge pass (lib/tech-manager.js). It does nothing
// until the owner switches it on, nothing outside production, and nothing outside its send
// window, so the schedule can run all day. `?dry=1` shows who would be texted and what they
// would be sent, and sends nothing.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ ok: false, error: 'POSTGRES_URL is not set.' }, { status: 503 });
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  try {
    return NextResponse.json({ ok: true, ...(await runTechManager({ dry })) });
  } catch (e) {
    console.error('tech-manager cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'tech manager failed' }, { status: 500 });
  }
}
const beat = withHeartbeat('tech-manager', run);
export const GET = beat;
export const POST = beat;
