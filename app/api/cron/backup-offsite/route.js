import { NextResponse } from 'next/server';
import { runOffsiteBackup } from '../../../../lib/offsite-backup';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Hourly: copy the tracker (once a day) and any new Blob files to the off-site
// Drive folder — see lib/offsite-backup.js. Uploads only what is new, so the
// first runs catch up over several passes.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const r = await runOffsiteBackup();
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e) {
    console.error('cron backup-offsite failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('backup-offsite', run);
export const GET = beat;
export const POST = beat;
