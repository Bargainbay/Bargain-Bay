import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { clientIp, honeypotTripped } from '../../../lib/antifraud';
import { isApprovedMember } from '../../../lib/pricing';
import { submitOffer, submitPublicOffer, OfferError } from '../../../lib/member-offers';

export const dynamic = 'force-dynamic';

// Anyone may offer on a unit. An approved reseller who is signed in is routed to the member path (their own price and
// floor, identity from the SESSION); everyone else is a guest who must give a name, email and phone.
export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let b; try { b = await req.json(); } catch { b = {}; }
  // A bot that fills the invisible field is answered as if it worked, and nothing is stored.
  if (honeypotTripped(b)) return NextResponse.json({ ok: true });
  try {
    const session = await getSession().catch(() => null);
    if (session && (await isApprovedMember(session))) return NextResponse.json(await submitOffer(session, b));
    const out = await submitPublicOffer({ ...b, ip: clientIp(req) });
    return NextResponse.json({ ok: true, id: out.id, check: 'email' });
  } catch (e) {
    if (e instanceof OfferError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
}
