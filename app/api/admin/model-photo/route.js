// Does this model have a stock photo on file?
//
// A vendor drop-off is, by definition, usually a model we have never carried —
// a vendor brings what a vendor brings — so most of them have no entry in
// data/images.json. The listing then leads with a category placeholder, which
// is both the wrong look and the reason the Meta feed skips the unit
// (hasRealImage is false for placeholder art).
//
// The rep has no way to know that from the form. This lets the intake screen
// tell them while they are still standing next to the appliance, instead of
// their finding out from the listing days later. It is a WARNING, never a
// block: the unit is perfectly sellable without one.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { modelImage } from '../../../../lib/images';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(s && isStaff(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const model = (new URL(req.url).searchParams.get('model') || '').trim();
  if (!model) return NextResponse.json({ model: '', hasStock: false, asked: false });
  // Exact-match lookup, exactly as the storefront does it — so the answer here
  // is the answer the site will give, typo and all.
  return NextResponse.json({ model, hasStock: !!modelImage(model), asked: true });
}
