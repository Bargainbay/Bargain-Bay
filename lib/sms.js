import { outbound, envBanner } from './environment';
// SMS via Twilio (REST API, no SDK — keeps deps minimal). Degrades to a logged
// no-op when Twilio isn't configured.
//
// ---------------------------------------------------------------------------
// TWO NUMBERS, AND THE REASON IS NOT TIDINESS.
//
// `TWILIO_FROM` is the OPERATIONS number. It carries the driver's six-digit
// sign-in code, their sign-in link, the evening shift nudge, and the outbound
// import-review call. `TWILIO_MARKETING_FROM` carries Bargain Bay adverts, and
// nothing else.
//
// They have to be different numbers because **Twilio's STOP handling blocks a
// NUMBER PAIR at carrier level, not a category of message.** When somebody
// texts STOP to one of our numbers, every later send from that number to them
// fails with error 21610 — silently, from the app's point of view.
//
// On one shared number that plays out like this: a driver is included in a
// marketing blast (they are a `users` row with a mobile on it, so `audience`
// picked them up), texts STOP because a liquidation-appliance advert is not why
// they gave us their number, and is then unable to receive a sign-in code. The
// first anybody hears about it is a driver standing at a van at 7am.
//
// It matters again the moment customer delivery SMS ships: opting out of
// adverts would otherwise carrier-block the "your driver is 20 minutes away"
// message too.
//
// So: marketing goes out from its own number, and an opt-out there can only
// ever cost somebody adverts.
// ---------------------------------------------------------------------------

export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** Is there a separate marketing number, or is marketing riding on operations? */
export function smsMarketingConfigured() {
  const m = process.env.TWILIO_MARKETING_FROM;
  return !!(m && m !== process.env.TWILIO_FROM);
}

/**
 * The number marketing sends from.
 *
 * FALLS BACK to the operations number rather than refusing to send. Deliberate,
 * and it is the same shape as everything else here: degrade open, then say so.
 * A hard refusal would break campaigns the moment this deploys and before the
 * second number is bought; a SILENT fallback would quietly recreate the bug
 * this exists to fix. So callers get `usedOpsNumber` back and the composer
 * shows it on screen — see components/CampaignComposer.
 */
export function marketingFrom() {
  return process.env.TWILIO_MARKETING_FROM || process.env.TWILIO_FROM;
}

/**
 * @param {object}  opts
 * @param {string}  opts.to
 * @param {string}  opts.body
 * @param {string} [opts.from] Defaults to the OPERATIONS number. Marketing must
 *   pass `marketingFrom()` explicitly — an omitted `from` should never quietly
 *   put an advert on the number drivers sign in with.
 */
export async function sendSms({ to, body, from }) {
  if (!smsConfigured()) {
    console.log('[sms skipped — Twilio not configured]');
    return { ok: false, skipped: true, reason: 'Twilio not configured' };
  }

  // Same reasoning as email, and it matters more: a staging deployment sharing
  // TWILIO_* would text real drivers sign-in codes for a system they are not
  // using, at whatever hour the cron happens to run.
  const gate = outbound('sms');
  if (!gate.allowed) {
    console.log(`[sms not sent — ${gate.reason}] ->`, to);
    return { ok: false, skipped: true, reason: gate.reason };
  }
  if (gate.redirectTo) {
    body = `${envBanner()} (to: ${to}) ${body}`;
    to = gate.redirectTo;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const sender = from || process.env.TWILIO_FROM;
  try {
    const params = new URLSearchParams({ To: to, From: sender, Body: String(body).slice(0, 1500) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 21610 is Twilio's "this person texted STOP to this number". It is not a
      // transient fault and retrying cannot fix it — the useful thing is to say
      // which number is blocked, because on the operations number that is a
      // driver who cannot sign in and nobody would otherwise know.
      const blocked = res.status === 400 && /21610|unsubscrib/i.test(JSON.stringify(data || {}));
      console.error('twilio send failed', res.status, data && data.message, blocked ? '(recipient opted out of this number)' : '');
      return { ok: false, status: res.status, error: (data && data.message) || 'send failed', optedOut: blocked };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error('twilio error', e.message);
    return { ok: false, error: e.message };
  }
}
