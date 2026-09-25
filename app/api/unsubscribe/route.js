// Opting out of marketing. Public by design — the person clicking this is by
// definition not signed in, and requiring an account to stop being emailed is
// not an unsubscribe mechanism.
//
// GET SHOWS, POST ACTS. This repo has already paid for that lesson once: the
// driver sign-in link was redeemed on GET, and the preview card iMessage and
// WhatsApp build by fetching the URL burned the link before the driver's thumb
// got there. Corporate mail scanners prefetch every link in a message the same
// way. So the emailed link lands on a page with one button, and this route only
// writes on POST.
//
// It also answers RFC 8058 one-click, which is what Gmail's and Outlook's own
// "Unsubscribe" button uses: those send a POST with
// `List-Unsubscribe=One-Click` as form data, and the List-Unsubscribe headers
// on the campaign email point here.
import { NextResponse } from 'next/server';
import { verifyUnsubToken } from '../../../lib/links';
import { withdrawConsent, withdrawAll, normEmail, normPhone } from '../../../lib/consent';
import { captureError } from '../../../lib/observe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Never say whether an address is on our list. This endpoint is unauthenticated
// and would otherwise answer "do you have a record for alice@example.com?" for
// anybody who asks.
const DONE = { ok: true };

async function unsubscribe(req, { identity, channel, all, token }) {
  if (!identity || !verifyUnsubToken(identity, token)) {
    return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
  }

  const isPhone = /^\+?\d[\d\s()-]*$/.test(identity) && !identity.includes('@');
  const email = isPhone ? null : normEmail(identity);
  const phone = isPhone ? normPhone(identity) : null;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const evidence = 'Unsubscribe link in a marketing message';

  try {
    if (all) {
      await withdrawAll({ email, phone, source: 'unsubscribe_link', evidence, ip });
    } else {
      await withdrawConsent({
        channel: channel === 'sms' ? 'sms' : 'email',
        email, phone, source: 'unsubscribe_link', evidence, ip
      });
    }
  } catch (e) {
    // This one does NOT degrade open. An unsubscribe that quietly fails is the
    // exact defect this whole change exists to fix, so the person is told to
    // try again rather than shown a false confirmation.
    await captureError(e, { tags: { where: 'unsubscribe' }, fingerprint: 'unsubscribe:write-failed' });
    return NextResponse.json(
      { error: 'We could not record that just now. Please try again, or email us and we will do it by hand.' },
      { status: 503 }
    );
  }
  return NextResponse.json(DONE);
}

export async function POST(req) {
  const url = new URL(req.url);
  let body = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) body = await req.json();
    else if (ct.includes('form')) {
      const f = await req.formData();
      body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
    }
  } catch { body = {}; }

  // RFC 8058: the mail client posts List-Unsubscribe=One-Click and nothing
  // else, so the identity and token have to come from the URL it was given.
  const identity = body.identity || url.searchParams.get('i') || '';
  const token = body.token || url.searchParams.get('t') || '';
  const channel = body.channel || url.searchParams.get('c') || 'email';
  const all = body.all === true || body.all === 'true' || url.searchParams.get('all') === '1'
    || body['List-Unsubscribe'] === 'One-Click';

  return unsubscribe(req, { identity, channel, all, token });
}
