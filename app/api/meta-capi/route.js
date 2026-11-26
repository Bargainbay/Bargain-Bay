import { NextResponse } from 'next/server';
import { clientIp } from '../../../lib/antifraud';
import { capiReady, capiUser, postMetaEvent } from '../../../lib/meta-capi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server side of the Meta pixel (Conversions API). The browser fires the event
// and posts the SAME eventId here, so Meta counts it once but still gets it
// when an ad blocker or iOS ate the browser half.
//
// Purchase is deliberately NOT accepted from a browser: an order is not a sale
// until it is paid. lib/meta-purchases.js sends it from the server.
//
// It soft-fails and ALWAYS answers 200: it must never disturb the page it rides
// on.
const EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout']);

export async function POST(req) {
  const ok = (extra = {}) => NextResponse.json({ ok: true, ...extra });
  try {
    if (!capiReady()) return ok({ skipped: true });

    let b; try { b = await req.json(); } catch { b = {}; }
    if (!EVENTS.has(b.eventName)) return ok({ skipped: true });

    const user = capiUser({
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      fbp: b.fbp, fbc: b.fbc, email: b.email, phone: b.phone
    });

    const ids = (Array.isArray(b.contentIds) ? b.contentIds : []).slice(0, 50).map(String);
    const value = Number(b.value);
    const r = await postMetaEvent({
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
    });
    if (!r.ok) console.error('meta-capi:', r.error);
    return ok();
  } catch (e) {
    console.error('meta-capi failed:', e?.message);
    return ok();
  }
}
