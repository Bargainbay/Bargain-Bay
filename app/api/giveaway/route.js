import { NextResponse } from 'next/server';
import { query, hasDb } from '../../../lib/db';
import { enterGiveaway, entryParam, checkEntryInput } from '../../../lib/giveaway';
import { GIVEAWAY, GIVEAWAY_EMAIL_TEXT, giveawayOpen, dayLabel } from '../../../lib/deals-config';
import { grantConsent } from '../../../lib/consent';
import { sendEmail, esc } from '../../../lib/email';
import {
  getSession, hashPassword, createSessionToken, sessionCookieOptions,
  SESSION_COOKIE, normalizeEmail
} from '../../../lib/auth';
import { upsertCustomer } from '../../../lib/customers';
import {
  clientIp, userAgent, honeypotTripped, isDisposableEmail, isBlocked,
  checkSignupRate, ensureAbuseSchema
} from '../../../lib/antifraud';
import { SITE_URL } from '../../../lib/site';

export const dynamic = 'force-dynamic';

// Entering REQUIRES three things (the contest rules say so): a Bargain Bay
// account, agreement to our deals-and-flyers email, and this form. So one POST
// does all three, in an order that never leaves half of it behind:
//   1. check everything that could fail on the user's input, BEFORE creating anything;
//   2. create the account (or use the signed-in one);
//   3. record the email consent, with the exact wording they were shown;
//   4. enter.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!giveawayOpen()) {
    return NextResponse.json({ error: 'This giveaway is not open for entries right now.' }, { status: 400 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: 'Entries are briefly unavailable. Please try again soon.' }, { status: 503 });
  }

  const ip = clientIp(req);
  await ensureAbuseSchema().catch((e) => console.error('abuse schema', e.message));
  // A bot gets the same friendly answer a person would, and nothing is stored.
  if (honeypotTripped(body)) return NextResponse.json({ ok: true, entered: true });

  // Signed in: that account is the entrant, whatever the form says. Otherwise the
  // typed email must be new, and a password is needed to create the account.
  const session = await getSession();
  const email = session ? normalizeEmail(session.email) : normalizeEmail(body.email);
  const input = { name: body.name || session?.name, email, phone: body.phone, postal: body.postal, eligible: body.eligible === true };

  if (await isBlocked({ email, ip, phone: body.phone })) {
    return NextResponse.json({ error: 'We are unable to accept this entry.' }, { status: 403 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json({ error: 'Please use a permanent email address so we can reach you if you win.' }, { status: 400 });
  }
  const bad = checkEntryInput(input);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (body.marketingOptIn !== true) {
    return NextResponse.json({ error: 'To enter, please tick the box to receive our deals and flyers email. You can unsubscribe at any time.' }, { status: 400 });
  }

  try {
    let user = null;
    let createdAccount = false;
    if (!session) {
      const password = String(body.password || '');
      if (password.length < 8) {
        return NextResponse.json({ error: 'Choose a password of at least 8 characters for your new account.' }, { status: 400 });
      }
      const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.length) {
        // An account exists: they must prove it is theirs by logging in, not by
        // typing the address, or anyone could enter on somebody else's account.
        return NextResponse.json({
          error: 'There is already a Bargain Bay account with that email. Please log in to enter.',
          login: true
        }, { status: 409 });
      }
      const rate = await checkSignupRate({ ip });
      if (!rate.ok) return NextResponse.json({ error: 'Too many accounts created from this connection. Please try again later.' }, { status: 429 });
      const hash = await hashPassword(password);
      const { rows } = await query(
        `INSERT INTO users (email, name, phone, password_hash, signup_ip)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING RETURNING id, email, name`,
        [email, String(input.name).trim().slice(0, 120), String(body.phone || '').trim() || null, hash, ip]
      );
      if (!rows.length) return NextResponse.json({ error: 'There is already a Bargain Bay account with that email. Please log in to enter.', login: true }, { status: 409 });
      user = rows[0];
      createdAccount = true;
      await query('UPDATE orders SET user_id = $1 WHERE user_id IS NULL AND email = $2', [user.id, email]).catch(() => {});
      upsertCustomer({ email, name: user.name, phone: body.phone, userId: user.id }).catch(() => {});
    }

    // The required subscription. The words stored are OURS (GIVEAWAY_EMAIL_TEXT),
    // the same sentence the form shows, never whatever the browser claims.
    await grantConsent({ channel: 'email', email, source: 'giveaway', ip, evidence: GIVEAWAY_EMAIL_TEXT });

    const r = await enterGiveaway(GIVEAWAY.id, { ...input, marketing: true }, { ip, userAgent: userAgent(req) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

    // The confirmation carries the link back to the checklist: it is the only way
    // back in. Sent for a repeat entry too, to the address on the entry (which
    // leaks nothing). Awaited: a serverless instance is frozen after the response.
    if (r.id) {
      const link = `${SITE_URL}/giveaway?e=${entryParam(r.id)}`;
      await sendEmail({
        to: r.email,
        subject: `You're entered: ${GIVEAWAY.title}`,
        html: `<p>Hi ${esc(r.name.split(' ')[0])},</p>
          <p>You're entered to win ${esc(GIVEAWAY.prize)}. We draw on ${esc(dayLabel(GIVEAWAY.drawDate))} and contact the winner by email or phone.</p>
          <p><b>Want more chances?</b> Follow us on Instagram, or send a short video of what you're thankful for. Both are optional and earn extra entries until ${esc(dayLabel(GIVEAWAY.to))}:</p>
          <p><a href="${link}">${link}</a></p>
          <p>You're also on our deals and flyers email list (about once a week); there is an unsubscribe link in every one, and your entry stays valid if you unsubscribe.</p>
          <p>Full contest rules: <a href="${SITE_URL}/giveaway#rules">${SITE_URL}/giveaway#rules</a></p>
          <p>Good luck,<br>Bargain Bay</p>`
      }).catch((e) => console.error('giveaway confirmation failed', e.message));
    }

    // The token goes to the browser that made a NEW entry. For a repeat it does
    // not: anyone can type somebody else's address, so that link only travels by email.
    const res = NextResponse.json({ ok: true, entered: r.entered, e: r.entered ? entryParam(r.id) : null, createdAccount });
    if (createdAccount) res.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions());
    return res;
  } catch (e) {
    console.error('giveaway entry failed', e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
