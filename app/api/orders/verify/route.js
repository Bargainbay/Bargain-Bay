import { NextResponse } from 'next/server';
import { verifyOrderByToken } from '../../../../lib/order-verify';
import { SITE_URL } from '../../../../lib/site';

export const dynamic = 'force-dynamic';

// Landing point for the "Confirm my order" link in the order email. GET-only by
// necessity — it's a link in an email — which is safe here because the token is
// 256 bits of unguessable randomness and the only effect is stamping the order
// verified. It cannot change money, items, or status.
//
// Always redirects to the public order page rather than rendering JSON, so the
// customer lands somewhere useful whatever the outcome.
export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const base = (SITE_URL || 'https://bargainbay.ca').replace(/\/$/, '');

  let order = null;
  try {
    order = await verifyOrderByToken(token);
  } catch (e) {
    console.error('order verify failed', e.message);
  }

  if (!order) {
    // Unknown or malformed token — most likely a very old link. Send them to
    // order lookup rather than a dead end.
    return NextResponse.redirect(`${base}/track?verify=invalid`, { status: 302 });
  }
  const url = `${base}/order/${encodeURIComponent(order.order_number)}`
    + `?email=${encodeURIComponent(order.email)}`
    + `&verify=${order.alreadyCancelled ? 'expired' : 'ok'}`;
  return NextResponse.redirect(url, { status: 302 });
}
