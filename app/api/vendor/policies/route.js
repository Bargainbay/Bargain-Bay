// A seller's policy acceptance: what is pending, and accepting it. Owner only to accept.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { acceptanceStatus, acceptPolicies } from '../../../../lib/policy-acceptance';
import { clientIp } from '../../../../lib/antifraud';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ctx = await requireVendor();
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const s = await acceptanceStatus(ctx.vendor.id);
  return NextResponse.json({ accepted: s.accepted, pending: s.pending.map((p) => ({ slug: p.slug, title: p.title, version: p.version })) });
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    return NextResponse.json(await acceptPolicies(ctx.vendor.id, { role: ctx.vendor.role, by: ctx.session.email, ip: clientIp(req), accepting: b?.accepting }));
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not record that.' }, { status: 400 });
  }
}
