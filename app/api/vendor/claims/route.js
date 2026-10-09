// A seller's warranty claims: list them, respond, resolve. The vendor id comes from the session; another
// seller's claim id is exactly "Claim not found". The customer's contact details are not in the data at all.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { listVendorClaims, vendorRespond, vendorResolve } from '../../../../lib/warranty-claims';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  return NextResponse.json({ claims: await listVendorClaims(ctx.vendor.id), now: new Date().toISOString() });
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const by = ctx.session.email;
  try {
    switch (b.action) {
      case 'respond': return NextResponse.json(await vendorRespond(ctx.vendor.id, id, { note: b.note, by }));
      case 'resolve': return NextResponse.json(await vendorResolve(ctx.vendor.id, id, { resolution: b.resolution, note: b.note, by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
