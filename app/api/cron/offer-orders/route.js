import { NextResponse } from 'next/server';
import { cancelUnpaidOfferOrders } from '../../../../lib/reservations';
import { expireOffers } from '../../../../lib/member-offers';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';

// Hourly: cancel orders made from an accepted offer that were not paid within OFFER_PAYMENT_HOURS (voids the web invoice, relists
// the unit), and close offers whose hold has run out. Its own schedule because the daily reservation sweep alone would
// turn "12 hours" into "up to 36".
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const cancelledOfferOrders = await cancelUnpaidOfferOrders();
    await expireOffers().catch(() => {});
    return NextResponse.json({ ok: true, cancelledOfferOrders });
  } catch (e) {
    console.error('offer-orders failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const beat = withHeartbeat('offer-orders', run);
export const GET = beat;
export const POST = beat;
