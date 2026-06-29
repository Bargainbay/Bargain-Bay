// Public: submit a post-delivery rating from the tokenised link in the
// "delivered" email. Token is the order link token (kind 'order').
import { NextResponse } from 'next/server';
import { submitRating } from '../../../lib/ratings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    await submitRating({ orderNumber: String(b.orderNumber || ''), token: String(b.token || ''), rating: b.rating, comment: b.comment });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not submit.' }, { status: 400 });
  }
}
