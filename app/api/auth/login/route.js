import { NextResponse } from 'next/server';
import { query, hasDb } from '../../../../lib/db';
import {
  verifyPassword, createSessionToken, sessionCookieOptions,
  SESSION_COOKIE, normalizeEmail
} from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Accounts are not available yet — database not configured.' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  try {
    const { rows } = await query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok) return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });

    const token = await createSessionToken(user);
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    console.error('login failed', e);
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
