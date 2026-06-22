import { NextResponse } from 'next/server';
import { SESSION_COOKIE, getSession, bumpTokenVersion } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Bump the user's token_version so this (and any other device's) session token
  // can't be replayed after logout — real server-side revocation, not just a
  // cookie clear in the caller's browser.
  const s = await getSession();
  if (s?.userId) await bumpTokenVersion(s.userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
