// One of the vendor's listings: read it, edit it, and move it through its lifecycle.
// A listing id belonging to another vendor answers exactly like one that doesn't exist.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../../lib/vendor-session';
import {
  getVendorListing, updateListing, checkListing, submitListing, pauseListing,
  resumeListing, reopenForEdit, withdrawListing
} from '../../../../../lib/marketplace-listings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const idOf = async (params) => Number((await params).id);

export async function GET(_req, { params }) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const l = await getVendorListing(ctx.vendor.id, await idOf(params));
  return l ? NextResponse.json({ listing: l }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(req, { params }) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const id = await idOf(params);
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = ctx.session.email;
  const v = ctx.vendor.id;
  try {
    switch (body?.action) {
      case 'update': return NextResponse.json(await updateListing(v, id, body.fields || {}, { by }));
      case 'check': return NextResponse.json(await checkListing(v, id));
      case 'submit': return NextResponse.json(await submitListing(v, id, { by }));
      case 'pause': return NextResponse.json(await pauseListing(v, id, { by }));
      case 'resume': return NextResponse.json(await resumeListing(v, id, { by }));
      case 'reopen': return NextResponse.json(await reopenForEdit(v, id, { by }));
      case 'withdraw': return NextResponse.json(await withdrawListing(v, id, { by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
