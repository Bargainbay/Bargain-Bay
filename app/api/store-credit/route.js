import { NextResponse } from 'next/server';
import { getStoreCredit } from '../../../lib/store-credit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// "How much is on this store credit code?" — the check behind the Apply button
// at checkout. It answers with a balance and nothing else (no name, no email, no
// history), and answers a code that doesn't exist and one that is spent the same
// way. Codes are 8 characters from a 31-letter alphabet, and lookups are throttled
// per address on top of that, so guessing one is not a practical way in.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 20;
}

export async function POST(req) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (throttled(ip)) return NextResponse.json({ ok: false, error: 'Too many tries. Please wait a few minutes.' }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const credit = await getStoreCredit(body.code).catch(() => null);
  if (!credit || credit.balance <= 0.004) {
    return NextResponse.json({ ok: false, error: 'That store credit code wasn’t found or has no balance left.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, code: credit.code, balance: credit.balance });
}
