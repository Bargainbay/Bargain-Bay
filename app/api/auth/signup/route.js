import { NextResponse } from 'next/server';
import { query, hasDb } from '../../../../lib/db';
import {
  hashPassword, createSessionToken, sessionCookieOptions,
  SESSION_COOKIE, normalizeEmail, validEmail
} from '../../../../lib/auth';
import { notifyOwner, esc } from '../../../../lib/email';
import { upsertCustomer } from '../../../../lib/customers';
import {
  clientIp, honeypotTripped, isDisposableEmail, isBlocked,
  checkSignupRate, ensureAbuseSchema
} from '../../../../lib/antifraud';

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

  // ---- abuse gate (see lib/antifraud.js) ----
  // An account isn't valuable on its own, but a signed-in buyer's order skips
  // the confirm-your-email step at checkout — so the same controls apply here.
  const ip = clientIp(req);
  await ensureAbuseSchema().catch((e) => console.error('abuse schema', e.message));

  if (honeypotTripped(body)) {
    console.warn('signup honeypot tripped', { ip, email });
    return NextResponse.json({ error: "We couldn't process that submission. Please email sales@bargainbay.ca if you need an account." }, { status: 400 });
  }
  if (await isBlocked({ email, ip, phone })) {
    console.warn('signup blocked by blocklist', { ip, email });
    return NextResponse.json({ error: 'We are unable to create an account for these details. Please contact sales@bargainbay.ca.' }, { status: 403 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: 'Please use a permanent email address so we can reach you about your orders.' }, { status: 400 });
  }
  const rate = await checkSignupRate({ ip });
  if (!rate.ok) {
    console.warn('signup rate limited', { ip, email });
    return NextResponse.json({ error: 'Too many accounts created from this connection. Please try again later.' }, { status: 429 });
  }

  try {
    const password_hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (email, name, phone, password_hash, signup_ip)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name`,
      [email, name, phone || null, password_hash, ip]
    );
    if (!rows.length) {
      return NextResponse.json({ error: 'An account with that email already exists. Try logging in.' }, { status: 409 });
    }
    const user = rows[0];
    // Claim any guest orders previously placed with this email.
    await query('UPDATE orders SET user_id = $1 WHERE user_id IS NULL AND email = $2', [user.id, email]).catch(() => {});
    // Fold into the client database (links the record to this new account).
    upsertCustomer({ email, name, phone, userId: user.id }).catch(() => {});

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
