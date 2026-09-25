// Inbound SMS — the other half of "Reply STOP to opt out".
//
// That sentence was on the end of every marketing text and nothing anywhere
// read the replies. Somebody who texted STOP stayed on the list.
//
// WHAT TWILIO DOES ON ITS OWN, and why this is still needed. Twilio intercepts
// the standard keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT) on its own
// numbers, blocks that number at its end, and replies with a confirmation —
// so the carrier-level block happens with or without this route. What Twilio
// cannot do is put the opt-out in OUR records. Without that we have no proof of
// compliance, the person still counts as a recipient in every campaign, and a
// number blocked at Twilio silently fails every send forever with nobody
// looking. So: point the number's "A MESSAGE COMES IN" webhook here.
//
// (If Advanced Opt-Out is switched on in Twilio, the keyword webhook is
// delivered here too. Either way this route is harmless and idempotent.)
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { withdrawConsent, grantConsent, normPhone } from '../../../../lib/consent';
import { captureError } from '../../../../lib/observe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same verification as /api/sarah/whatsapp: HMAC-SHA1 over the exact URL plus
// every POST parameter sorted by name, keyed by the auth token. Without it
// anybody who knows the URL can opt out any number they like — or, worse,
// opt one back IN.
function twilioValid(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

function webhookUrl(req) {
  if (process.env.TWILIO_SMS_WEBHOOK_URL) return process.env.TWILIO_SMS_WEBHOOK_URL;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}/api/sms/inbound`;
}

// The carrier-standard keywords. Matched on the WHOLE message after trimming:
// "stop" opts out, "please stop sending me these" also should, but "one-stop
// shop" in a reply to a sales text must not.
const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|optout|opt-out|remove)\b/i;
const START_WORDS = /^(start|unstop|yes|subscribe|optin|opt-in)\b/i;
const HELP_WORDS = /^(help|info)\b/i;

const twiml = (message) =>
  new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${
      message ? `<Message>${message.replace(/[<>&]/g, '')}</Message>` : ''
    }</Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );

export async function POST(req) {
  const params = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : '';
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  if (!twilioValid(webhookUrl(req), params, req.headers.get('x-twilio-signature'))) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const from = normPhone(params.From);
  const body = String(params.Body || '').trim();
  if (!from) return twiml('');

  try {
    if (STOP_WORDS.test(body)) {
      await withdrawConsent({
        channel: 'sms', phone: from, source: 'sms_stop',
        evidence: `Texted: ${body.slice(0, 200)}`
      });
      // Twilio sends its own confirmation for the keywords it intercepts;
      // replying again would double-text somebody who just asked us to stop.
      return twiml('');
    }

    if (START_WORDS.test(body)) {
      // An opt-in by text is express consent, and the text itself is the
      // evidence — but only ever as a reply to a STOP. Nobody is added to a
      // marketing list because they texted "yes" to a delivery question, so
      // this is recorded and the campaign filter still requires it to be the
      // latest word on the matter.
      await grantConsent({
        channel: 'sms', phone: from, source: 'reply',
        evidence: `Texted: ${body.slice(0, 200)}`
      });
      return twiml('');
    }

    if (HELP_WORDS.test(body)) {
      return twiml('Bargain Bay — liquidation appliances, Pickering ON. Reply STOP to opt out. sales@bargainbay.ca');
    }
  } catch (e) {
    // An opt-out we failed to record is the whole defect this change exists to
    // fix, so it is reported rather than swallowed. Twilio retries on a 5xx,
    // which is what we want here.
    await captureError(e, { tags: { where: 'sms-inbound' }, fingerprint: 'sms-inbound:write-failed' });
    return new NextResponse('error', { status: 500 });
  }

  // Anything else is a human replying to a text. Nothing here answers those —
  // they land in the Twilio console, and pretending to reply would be worse
  // than silence.
  return twiml('');
}
