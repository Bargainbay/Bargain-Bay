// One-time helper: registers Sarah's Telegram webhook. Admin-gated. Once
// TELEGRAM_BOT_TOKEN (+ TELEGRAM_WEBHOOK_SECRET) are set, the owner visits this
// URL while logged into /admin to point the bot at /api/sarah/telegram.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { setWebhook, telegramConfigured } from '../../../../lib/telegram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!telegramConfigured()) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set yet.' }, { status: 503 });

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const url = `${proto}://${host}/api/sarah/telegram`;
  try {
    const result = await setWebhook(url, process.env.TELEGRAM_WEBHOOK_SECRET);
    return NextResponse.json({ ok: true, webhook: url, telegram: result });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'setWebhook failed' }, { status: 500 });
  }
}
