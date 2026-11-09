// A referral partner's END-USER link. Remembers the partner for 30 days (so whatever this person buys is theirs) and
// opens the shop with the partner's discount code ready: RefCapture keeps ?ref=CODE and checkout applies it.
import { NextResponse } from 'next/server';
import { partnerByCode, recordVisit, ensureCustomerCoupon, PARTNER_COOKIE } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { code } = await params;
  const p = await partnerByCode(code);
  const coupon = p ? await ensureCustomerCoupon(p.email) : null;
  const res = NextResponse.redirect(new URL(coupon ? `/shop?ref=${encodeURIComponent(coupon)}` : '/shop', req.url));
  if (p) {
    const opts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 };
    res.cookies.set(PARTNER_COOKIE, p.code, opts);
    let visitor = req.cookies.get('bb_pv')?.value;
    if (!visitor) { visitor = crypto.randomUUID().replace(/-/g, '').slice(0, 20); res.cookies.set('bb_pv', visitor, { ...opts, maxAge: 60 * 60 * 24 * 365 }); }
    await recordVisit(p.code, visitor, req.headers.get('user-agent') || '');
  }
  return res;
}
