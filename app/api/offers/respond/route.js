import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasDb } from '../../../../lib/db';
import { confirmOffer, withdrawOffer, acceptCounter, offerByLink, offerCookieValue, OFFER_COOKIE, OfferError } from '../../../../lib/member-offers';

export const dynamic = 'force-dynamic';

// The emailed link's own actions. The id + token ARE the credential (an HMAC, derived not stored).
// GET of the page only shows; this POST acts, so a mail scanner opening the link changes nothing.
export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const id = Number(b.id); const token = String(b.t || '');
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Which offer?' }, { status: 400 });
  try {
    if (b.action === 'confirm') return NextResponse.json(await confirmOffer(id, token));
    if (b.action === 'withdraw') return NextResponse.json(await withdrawOffer({ token }, id));
    if (b.action === 'accept_counter') return NextResponse.json(await acceptCounter({ token }, id));
    if (b.action === 'claim') {
      // Opening an accepted offer's link sets the cookie that lets this browser buy the held unit at the agreed price.
      const o = await offerByLink(id, token);
      if (!o || o.status !== 'accepted') throw new OfferError('That offer is not open.', 'notfound');
      const res = NextResponse.json({ ok: true, sku: o.sku });
      const prev = (await cookies()).get(OFFER_COOKIE)?.value || '';
      res.cookies.set(OFFER_COOKIE, offerCookieValue(prev, id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 3 });
      return res;
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    if (e instanceof OfferError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
}
