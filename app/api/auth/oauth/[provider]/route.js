import { NextResponse } from 'next/server';
import { isProvider, authorizeUrl, newState, safeNext, STATE_COOKIE } from '../../../../../lib/oauth';

export const dynamic = 'force-dynamic';

// Step 1: send the browser to the provider. The random state is also kept in an
// httpOnly cookie; the callback refuses anything that does not match it (CSRF).
export async function GET(req, { params }) {
  const { provider } = await params;
  const next = safeNext(new URL(req.url).searchParams.get('next'));
  const state = newState();
  const url = isProvider(provider) ? authorizeUrl(provider, { state }) : null;
  if (!url) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent('That sign-in method is not available.')}`, req.url));
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, next }), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600
  });
  return res;
}
