// Warranty claims, from the staff side. Opening, noting, resolving and closing a claim is the customer's
// sale and open to staff; RECORDING MONEY OUT and charging the seller is the business's books: admin only,
// and the cost figures are not even sent to a staff browser.
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../../lib/auth';
import { listClaims, openClaim, staffNote, staffResolve, closeClaim, chargeClaim, claimsForViewer } from '../../../../../lib/warranty-claims';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  const claims = await listClaims({ status: new URL(req.url).searchParams.get('status') || undefined });
  return NextResponse.json({ claims: claimsForViewer(claims, isAdmin(s)), now: new Date().toISOString() });
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = s.email;
  try {
    switch (b?.action) {
      case 'open': return NextResponse.json(await openClaim({ vendorOrderId: Number(b.vendorOrderId), sku: b.sku || undefined, description: b.description, by }));
      case 'note': return NextResponse.json(await staffNote(Number(b.id), { note: b.note, internal: !!b.internal, by }));
      case 'resolve': return NextResponse.json(await staffResolve(Number(b.id), { resolution: b.resolution, note: b.note, by }));
      case 'close': return NextResponse.json(await closeClaim(Number(b.id), { reason: b.reason, by }));
      case 'charge':
        if (!isAdmin(s)) return denied();
        return NextResponse.json(await chargeClaim(Number(b.id), { amountCents: Math.round(Number(b.dollars) * 100), kind: b.kind, note: b.note, by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
