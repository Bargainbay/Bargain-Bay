import { NextResponse } from 'next/server';
import { quoteDelivery } from '../../../lib/delivery-fee';
import { clientIp } from '../../../lib/antifraud';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// "What does delivery to this address cost?" — the preview behind the checkout page's delivery line.
// /api/checkout prices it again from scratch; this figure is only ever shown, never trusted.
// Each uncached call is a Google Routes request, so it is rate-limited per IP (per instance).
const HITS = new Map();
const LIMIT = 40, WINDOW_MS = 10 * 60 * 1000;

export async function POST(req) {
  const ip = clientIp(req) || 'unknown';
  const now = Date.now();
  const h = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (h.length >= LIMIT) return NextResponse.json({ ok: false, error: 'Too many lookups. Try again in a few minutes.' }, { status: 429 });
  h.push(now); HITS.set(ip, h);
  if (HITS.size > 2000) HITS.clear();

  let body; try { body = await req.json(); } catch { body = {}; }
  const address = String(body.address || '').trim().slice(0, 200);
  const city = String(body.city || '').trim().slice(0, 100);
  const postal = String(body.postal || '').trim().slice(0, 12);
  if (!address || !city) return NextResponse.json({ ok: false, error: 'Address and city are needed.' }, { status: 400 });
  const q = await quoteDelivery({ address, city, postal });
  return NextResponse.json({ ok: true, ...q });
}
