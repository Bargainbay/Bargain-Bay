import { NextResponse } from 'next/server';
import {
  createSessionToken, sessionCookieOptions, SESSION_COOKIE, DRIVER_SESSION_DAYS
} from '../../../lib/auth';
import { redeemDriverSignInLink, touchDriverSeen } from '../../../lib/drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The whole of a driver's sign-in: they tap the link in the text message and
// land on their stops, signed in on that phone. No password, no signup form, no
// app store. The link is single-use, so the text sitting in their message
// history is not a spare key.
export async function GET(req, { params }) {
  const { token } = await params;
  const user = await redeemDriverSignInLink(token).catch(() => null);
  if (!user) {
    // Deliberately vague and calm: the usual reason is a driver tapping last
    // week's text, and the fix is always the same — ask the office to re-send.
    return NextResponse.redirect(new URL('/driver?link=expired', req.url));
  }
  const jwt = await createSessionToken(user, { days: DRIVER_SESSION_DAYS });
  const res = NextResponse.redirect(new URL('/driver?welcome=1', req.url));
  res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions({ days: DRIVER_SESSION_DAYS }));
  touchDriverSeen(user.id).catch(() => {});
  return res;
}
