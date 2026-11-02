import { NextResponse } from 'next/server';
import { verifyClientToken } from '../../../../lib/client-portal';
import { attemptPortalLogin, portalCookieName } from '../../../../lib/client-portal-auth';

export const dynamic = 'force-dynamic';

const ip = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

// Password for a client's portal. POST { c, t, password } signs in; { c, t, logout: true } signs out.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  if (!verifyClientToken(body?.c, body?.t)) return NextResponse.json({ error: 'This link is not valid.' }, { status: 403 });

  const secure = process.env.NODE_ENV === 'production';
  if (body.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(portalCookieName(body.c), '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
    return res;
  }
  const r = await attemptPortalLogin(body.c, body.password, ip(req));
  if (r.reason === 'no_password') return NextResponse.json({ error: 'Portal access has not been set up yet. Please contact dispatch.' }, { status: 403 });
  if (r.locked) return NextResponse.json({ error: 'Too many wrong passwords. Please wait 15 minutes, or contact dispatch.' }, { status: 429 });
  if (!r.ok) return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(r.cookie.name, r.cookie.value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: r.cookie.maxAge });
  return res;
}
