import { NextResponse } from 'next/server';
import { runExpireReservations } from '../../../../lib/cron-jobs';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';

// Reservation / abandoned-order cleanup, on its own. No longer scheduled by
// itself — /api/cron/nightly runs it — but kept for triggering by hand.
// /api/checkout also calls the same helper opportunistically.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runExpireReservations()) });
  } catch (e) {
    console.error('expire-reservations failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const beat = withHeartbeat('expire-reservations', run);
export const GET = beat;
export const POST = beat;
