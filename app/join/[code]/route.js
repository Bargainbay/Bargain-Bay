// A referral partner's link. Remembers who sent the visitor for 30 days, then sends them to the reseller page
// to create an account and apply. An unknown or revoked code does nothing but still lands them on the page.
import { NextResponse } from 'next/server';
import { partnerByCode, recordVisit, PARTNER_COOKIE } from '../../../lib/referral-partners';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL('/resellers', req.url));
  const p = await partnerByCode(code);
  if (p) {
    const opts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 };
    res.cookies.set(PARTNER_COOKIE, p.code, opts);
    // A random id per browser, so the partner is told how many PEOPLE opened the link, not how many times.
    let visitor = req.cookies.get('bb_pv')?.value;
    if (!visitor) { visitor = crypto.randomUUID().replace(/-/g, '').slice(0, 20); res.cookies.set('bb_pv', visitor, { ...opts, maxAge: 60 * 60 * 24 * 365 }); }
    await recordVisit(p.code, visitor, req.headers.get('user-agent') || '');
  }
  return res;
}
