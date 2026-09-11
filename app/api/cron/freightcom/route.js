import { NextResponse } from 'next/server';
import { watchFreightcom } from '../../../../lib/freightcom-watch';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Reading a BOL is a model call per email. Fifteen of them will not finish in
// the default ten seconds.
export const maxDuration = 300;

// Picks up Parallel's Freightcom notifications and STAGES them. Nothing here
// reaches the board — see lib/freightcom-watch.js.
//
// `?dry=1` reads and redirects without writing a batch, which is how to check
// what it would do against real mail without putting anything on the Import tab.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const url = new URL(req.url);
  try {
    const out = await watchFreightcom({
      max: Number(url.searchParams.get('max')) || 15,
      dryRun: url.searchParams.get('dry') === '1'
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error('freightcom cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
