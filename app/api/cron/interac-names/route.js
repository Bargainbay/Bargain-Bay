import { NextResponse } from 'next/server';
import { nameTransfersFromEmail } from '../../../../lib/interac-names';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Names e-transfer lines from Interac's confirmation emails (see lib/interac-names.js).
// `?dry=1` reports what it WOULD name without writing anything.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const out = await nameTransfersFromEmail({ dryRun: new URL(req.url).searchParams.get('dry') === '1' });
    // A run that could not read the mailbox is a failure, not a quiet success.
    return NextResponse.json(out, { status: out.ok ? 200 : 500 });
  } catch (e) {
    console.error('interac-names cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('interac-names', run);
export const GET = beat;
export const POST = beat;
