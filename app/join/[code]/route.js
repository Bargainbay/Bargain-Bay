// A referral partner's link. Remembers who sent the visitor for 30 days, then sends them to the reseller page
// to create an account and apply. An unknown or revoked code does nothing but still lands them on the page.
import { NextResponse } from 'next/server';
import { partnerByCode, PARTNER_COOKIE } from '../../../lib/referral-partners';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { code } = await params;
  const res = NextResponse.redirect(new URL('/resellers', req.url));
  const p = await partnerByCode(code);
  if (p) res.cookies.set(PARTNER_COOKIE, p.code, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
