import { NextResponse } from 'next/server';
import { runStockReconcile } from '../../../../lib/stock-reconcile';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every morning: whatever RS Ops has that the tracker doesn't goes onto it, and
// the owner gets one email listing units still waiting for a purchase invoice and
// sales that never named a stock unit — only on a day there is something to say.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const email = new URL(req.url).searchParams.get('email') !== '0';
  try {
    return NextResponse.json({ ok: true, ...(await runStockReconcile({ email })) });
  } catch (e) {
    console.error('cron inventory-gaps failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('inventory-gaps', run);
export const GET = beat;
export const POST = beat;
