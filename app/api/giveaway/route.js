import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db';
import { enterGiveaway, entryParam } from '../../../lib/giveaway';
import { GIVEAWAY, giveawayOpen, dayLabel } from '../../../lib/deals-config';
import { grantConsent } from '../../../lib/consent';
import { sendEmail, esc } from '../../../lib/email';
import { clientIp, userAgent, honeypotTripped, isDisposableEmail, isBlocked, ensureAbuseSchema } from '../../../lib/antifraud';
import { SITE_URL } from '../../../lib/site';

export const dynamic = 'force-dynamic';

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
  if (await isBlocked({ email: body.email, ip, phone: body.phone })) {
    return NextResponse.json({ error: 'We are unable to accept this entry.' }, { status: 403 });
  }
  if (isDisposableEmail(body.email)) {
    return NextResponse.json({ error: 'Please use a permanent email address so we can reach you if you win.' }, { status: 400 });
  }

  try {
    const r = await enterGiveaway(GIVEAWAY.id, {
      name: body.name, email: body.email, phone: body.phone, postal: body.postal,
      eligible: body.eligible === true, marketing: body.marketingOptIn === true
    }, { ip, userAgent: userAgent(req) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

    if (r.entered) {
      // Express consent, only if the separate box was ticked, with the words
      // they were shown. Never a condition of entry.
      if (body.marketingOptIn === true) {
        await grantConsent({
          channel: 'email', email: r.email, source: 'giveaway', ip,
          evidence: String(body.marketingOptInText || '').slice(0, 500) || 'Ticked the marketing box on the giveaway entry form'
        }).catch((e) => console.error('giveaway consent record failed', e.message));
      }
    }
    // A confirmation goes out for a repeat entry too, carrying the link back to
    // the checklist: it is the only way back in, and sending it to the address
    // on the entry (not to whoever typed it) leaks nothing. Awaited: a
    // serverless instance is frozen once the response goes out.
    if (r.id) {
      const link = `${SITE_URL}/giveaway?e=${entryParam(r.id)}`;
      await sendEmail({
        to: r.email,
        subject: `You're entered: ${GIVEAWAY.title}`,
        html: `<p>Hi ${esc(r.name.split(' ')[0])},</p>
          <p>You're entered to win ${esc(GIVEAWAY.prize)}. We draw on ${esc(dayLabel(GIVEAWAY.drawDate))} and contact the winner by email or phone.</p>
          <p><b>Want more chances?</b> Create an account, subscribe to our deals and flyers, follow us on Instagram, or send a short video of what you're thankful for. Each is optional and earns extra entries until ${esc(dayLabel(GIVEAWAY.to))}:</p>
          <p><a href="${link}">${link}</a></p>
          <p>Full contest rules: <a href="${SITE_URL}/giveaway#rules">${SITE_URL}/giveaway#rules</a></p>
          <p>Good luck,<br>Bargain Bay</p>`
      }).catch((e) => console.error('giveaway confirmation failed', e.message));
    }
    // The token goes to the browser that made a NEW entry. For a repeat it does
    // not: anyone can type somebody else's address, so that link only travels by email.
    return NextResponse.json({ ok: true, entered: r.entered, e: r.entered ? entryParam(r.id) : null });

  } catch (e) {
    console.error('giveaway entry failed', e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
