import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { getSession } from '../../../lib/auth';
import { subscribeToTexts } from '../../../lib/sms-subscribe';
import { ensureConsentSchema } from '../../../lib/consent';
import { clientIp, honeypotTripped, isBlocked } from '../../../lib/antifraud';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PER_HOUR = 5; // sign-ups from one connection

export async function POST(req) {
  let body; try { body = await req.json(); } catch { body = {}; }
  if (honeypotTripped(body)) return NextResponse.json({ ok: true });
  if (body.agree !== true) return NextResponse.json({ error: 'Press the button to agree to deal texts.' }, { status: 400 });
  const ip = clientIp(req);
  try {
    if (await isBlocked({ phone: body.phone, ip }).catch(() => false)) return NextResponse.json({ ok: true });
    if (ip && ip !== 'unknown') {
      await ensureConsentSchema();
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM consent_events WHERE ip = $1 AND channel = 'sms' AND source = 'website' AND at > now() - interval '1 hour'`, [ip]);
      if (rows[0]?.n >= PER_HOUR) return NextResponse.json({ error: 'Too many sign-ups from this connection. Please try again later.' }, { status: 429 });
    }
    const session = await getSession().catch(() => null);
    const where = String(body.where || '').replace(/[^a-z0-9 /_-]/gi, '').slice(0, 60);
    const r = await subscribeToTexts({ phone: body.phone, name: session?.name, ip, where: where ? `the ${where} sign-up box` : 'a website sign-up box' });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('sms subscribe failed', e.message);
    return NextResponse.json({ error: 'Could not sign you up. Please try again.' }, { status: 500 });
  }
}
