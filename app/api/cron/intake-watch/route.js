import { NextResponse } from 'next/server';
import { watchInvoiceInbox } from '../../../../lib/intake-watch';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Scan the intake inbox for purchase invoices → stage them in the review queue.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await watchInvoiceInbox()) });
  } catch (e) {
    console.error('intake-watch failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('intake-watch', run);
export const GET = beat;
export const POST = beat;
