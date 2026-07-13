// Complete a password reset: valid token + new password → new hash, bump
// token_version (kills the used link, other links, and every session), then
// sign the user straight in on this browser.
import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../../lib/db';
import {
  verifyPasswordResetToken, hashPassword, bumpTokenVersion,
  createSessionToken, sessionCookieOptions, SESSION_COOKIE
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Accounts are unavailable right now.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const password = String(body.password || '');
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  const valid = await verifyPasswordResetToken(body.token);
  if (!valid) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired. Request a new one from the login page.' }, { status: 403 });
  }

  try {
    const { rows } = await query('SELECT id, email, name FROM users WHERE id = $1', [valid.userId]);
    if (!rows.length) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [valid.userId, await hashPassword(password)]);
    await bumpTokenVersion(valid.userId);
    const token = await createSessionToken(rows[0]);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    console.error('password reset failed', e);
    return NextResponse.json({ error: 'Could not reset your password. Please try again.' }, { status: 500 });
  }
}
