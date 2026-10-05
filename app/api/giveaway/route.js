import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db';
import { enterGiveaway } from '../../../lib/giveaway';
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
      // Confirms the address works (a winner we cannot reach is a wasted draw)
      // and is the entrant's own copy of the rules link. Awaited: a serverless
      // instance is frozen once the response goes out.
      await sendEmail({
        to: r.email,
        subject: `You're entered: ${GIVEAWAY.title}`,
        html: `<p>Hi ${esc(r.name.split(' ')[0])},</p>
          <p>You're entered to win ${esc(GIVEAWAY.prize)}. We draw on ${esc(dayLabel(GIVEAWAY.drawDate))} and contact the winner by email or phone.</p>
          <p>Full contest rules: <a href="${SITE_URL}/giveaway#rules">${SITE_URL}/giveaway#rules</a></p>
          <p>Good luck,<br>Bargain Bay</p>`
      }).catch((e) => console.error('giveaway confirmation failed', e.message));
    }
    return NextResponse.json({ ok: true, entered: r.entered });
  } catch (e) {
    console.error('giveaway entry failed', e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
