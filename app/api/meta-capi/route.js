import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { clientIp } from '../../../lib/antifraud';
import { isProduction } from '../../../lib/environment';
import { FB_PIXEL_ID } from '../../../lib/fpixel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server side of the Meta pixel (Conversions API). The browser fires the event
// and posts the SAME eventId here, so Meta counts it once but still gets it
// when an ad blocker or iOS ate the browser half.
//
// It soft-fails and ALWAYS answers 200: it must never disturb the page it rides
// on. Nothing leaves outside production, so a preview deploy cannot put test
// orders into the real dataset. Email and phone are hashed here, never sent raw.
const EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const clean = (s) => String(s || '').trim().toLowerCase();

export async function POST(req) {
  const ok = (extra = {}) => NextResponse.json({ ok: true, ...extra });
  try {
    const token = process.env.META_CAPI_ACCESS_TOKEN;
    const pixel = FB_PIXEL_ID || process.env.NEXT_PUBLIC_FB_PIXEL_ID;
    if (!token || !pixel || !isProduction()) return ok({ skipped: true });

    let b; try { b = await req.json(); } catch { b = {}; }
    if (!EVENTS.has(b.eventName)) return ok({ skipped: true });

    const user = {
      client_ip_address: clientIp(req),
      client_user_agent: req.headers.get('user-agent') || undefined,
      fbp: b.fbp || undefined,
      fbc: b.fbc || undefined
    };
    const email = clean(b.email);
    if (email.includes('@')) user.em = [sha(email)];
    const phone = String(b.phone || '').replace(/\D/g, '');
    if (phone.length >= 10) user.ph = [sha(phone)];

    const ids = (Array.isArray(b.contentIds) ? b.contentIds : []).slice(0, 50).map(String);
    const value = Number(b.value);
    const event = {
      event_name: b.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: b.eventId ? String(b.eventId).slice(0, 100) : undefined,
      event_source_url: b.eventSourceUrl ? String(b.eventSourceUrl).slice(0, 500) : undefined,
      action_source: 'website',
      user_data: user,
      custom_data: {
        content_ids: ids,
        content_type: 'product',
        currency: 'CAD',
        ...(Number.isFinite(value) ? { value } : {})
      }
    };

    const payload = { data: [event] };
    if (process.env.META_CAPI_TEST_CODE) payload.test_event_code = process.env.META_CAPI_TEST_CODE;

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) console.error('meta-capi: Meta answered', res.status, (await res.text()).slice(0, 300));
    return ok();
  } catch (e) {
    console.error('meta-capi failed:', e?.message);
    return ok();
  }
}
