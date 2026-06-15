import { NextResponse } from 'next/server';
import { query, hasDb } from '../../../../lib/db';
import {
  hashPassword, createSessionToken, sessionCookieOptions,
  SESSION_COOKIE, normalizeEmail, validEmail
} from '../../../../lib/auth';
import { notifyOwner, esc } from '../../../../lib/email';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Accounts are not available yet — database not configured.' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');

  if (!validEmail(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  try {
    const password_hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (email, name, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name`,
      [email, name, phone || null, password_hash]
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'An account with that email already exists. Try logging in.' }, { status: 409 });
    }
    const user = rows[0];
    // Claim any guest orders previously placed with this email.
    await query('UPDATE orders SET user_id = $1 WHERE user_id IS NULL AND email = $2', [user.id, email]).catch(() => {});

    // Notify the owner (fire-and-forget; never blocks signup).
    notifyOwner(
      `New account: ${name} (${email})`,
      `<p>A new customer account was created on Bargain Bay.</p>
       <ul><li><b>Name:</b> ${esc(name)}</li><li><b>Email:</b> ${esc(email)}</li><li><b>Phone:</b> ${esc(phone) || '—'}</li></ul>`
    ).catch(() => {});

    const token = await createSessionToken(user);
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    console.error('signup failed', e);
    return NextResponse.json({ error: 'Could not create your account. Please try again.' }, { status: 500 });
  }
}
