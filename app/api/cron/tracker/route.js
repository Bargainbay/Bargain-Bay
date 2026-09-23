import { NextResponse } from 'next/server';
import { backfillTrackers } from '../../../../lib/tracker-watch';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// The truck's TRAIL, as distinct from its dot — see lib/tracker-watch.js.
//
// This deliberately does NOT sample the last position. It asks PAJ for
// everything the device recorded since our newest ping, so the hours nobody had
// the Live tab open are filled in properly rather than left as gaps. That is
// also why it is a separate vercel.json entry rather than another step folded
// into an existing pass: each scheduled invocation gets its own time budget, and
// a backfill after an outage is the long one.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json(await backfillTrackers());
  } catch (e) {
    console.error('tracker cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
