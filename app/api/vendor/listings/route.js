// A vendor's own listings: list and start a new draft. The vendor comes from the
// session, never from the request.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { listVendorListings, createDraft } from '../../../../lib/marketplace-listings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const status = new URL(req.url).searchParams.get('status') || undefined;
  return NextResponse.json({ listings: await listVendorListings(ctx.vendor.id, { status }) });
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    return NextResponse.json({ ok: true, ...(await createDraft(ctx.vendor.id, body || {}, { by: ctx.session.email })) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not start that listing.' }, { status: 400 });
  }
}
