import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { emailConfigured } from '../../../../lib/email';
import { smsConfigured } from '../../../../lib/sms';
import { audience, audienceCounts, sendEmailCampaign, sendSmsCampaign } from '../../../../lib/campaigns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

const SEGMENTS = ['all', 'buyers', 'members'];

// Live audience counts + channel config for the composer.
export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const seg = new URL(req.url).searchParams.get('segment');
  const segment = SEGMENTS.includes(seg) ? seg : 'buyers';
  const counts = await audienceCounts(segment);
  return NextResponse.json({ segment, counts, emailConfigured: emailConfigured(), smsConfigured: smsConfigured() });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const channel = body.channel === 'sms' ? 'sms' : 'email';
  const segment = SEGMENTS.includes(body.segment) ? body.segment : 'buyers';
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();
  const testTo = String(body.testTo || '').trim();

  if (!message) return NextResponse.json({ error: 'Write a message first.' }, { status: 400 });
  if (channel === 'email' && !subject) return NextResponse.json({ error: 'Email needs a subject.' }, { status: 400 });
  if (channel === 'email' && !emailConfigured()) return NextResponse.json({ error: 'Email isn\'t configured (RESEND_API_KEY).' }, { status: 503 });
  if (channel === 'sms' && !smsConfigured()) return NextResponse.json({ error: 'SMS isn\'t configured (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM).' }, { status: 503 });

  // ---- test send (single recipient) ----
  if (testTo) {
    if (channel === 'email') {
      if (!validEmail(testTo)) return NextResponse.json({ error: 'Enter a valid test email.' }, { status: 400 });
      const result = await sendEmailCampaign({ recipients: [{ name: '', email: normalizeEmail(testTo) }], subject, message });
      return NextResponse.json({ ok: true, test: true, result });
    }
    const result = await sendSmsCampaign({ recipients: [{ name: '', phone: testTo }], message });
    return NextResponse.json({ ok: true, test: true, result });
  }

  // ---- full campaign ----
  const recipients = await audience(segment);
  const result = channel === 'email'
    ? await sendEmailCampaign({ recipients, subject, message })
    : await sendSmsCampaign({ recipients, message });
  return NextResponse.json({ ok: true, result });
}
