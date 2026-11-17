import { NextResponse } from 'next/server';
import { scanPayments } from '../../../../lib/manager-payments';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every 30 minutes: read the e-transfer confirmations in the service mailbox and
// mark paid the ones that match an invoice on amount, date and name. Anything that
// does not match cleanly is kept for the owner (lib/manager-payments.js).
// `?dry=1` reads and decides without changing anything.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const dry = new URL(req.url).searchParams.get('dry') === '1';
    const r = await scanPayments({ dept: 'sales', dry });
    // A mailbox that cannot be read is a failed run, so the health email says so.
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    console.error('cron manager-payments failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('manager-payments', run);
export const GET = beat;
export const POST = beat;
