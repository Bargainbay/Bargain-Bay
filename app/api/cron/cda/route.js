import { NextResponse } from 'next/server';
import { watchCdaSheet } from '../../../../lib/cda-watch';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Reads CDA's shared workbook and STAGES anything new — see lib/cda-watch.js.
// `?dry=1` reads and diffs without writing a batch or remembering the rows.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const url = new URL(req.url);
  try {
    return NextResponse.json(await watchCdaSheet({ dryRun: url.searchParams.get('dry') === '1' }));
  } catch (e) {
    console.error('cda cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
