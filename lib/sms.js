// SMS via Twilio (REST API, no SDK — keeps deps minimal). Degrades to a logged
// no-op when Twilio isn't configured.
export function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

export async function sendSms({ to, body }) {
  if (!smsConfigured()) {
    console.log('[sms skipped — Twilio not configured]');
    return { ok: false, skipped: true, reason: 'Twilio not configured' };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  try {
    const params = new URLSearchParams({ To: to, From: from, Body: String(body).slice(0, 1500) });
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
      console.error('twilio send failed', res.status, data && data.message);
      return { ok: false, status: res.status, error: (data && data.message) || 'send failed' };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error('twilio error', e.message);
    return { ok: false, error: e.message };
  }
}
