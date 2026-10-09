// A business applies to sell on the marketplace. Public, so: honeypot, per-email and global
// throttles in Postgres (lib/vendor-admin.js), and it grants NOTHING — staff review every application.
import { NextResponse } from 'next/server';
import { honeypotTripped, isDisposableEmail } from '../../../../lib/antifraud';
import { submitPublicApplication } from '../../../../lib/vendor-admin';
import { notifyOwner, esc } from '../../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  // A bot gets the same answer a person would, so it learns nothing.
  if (honeypotTripped(body)) return NextResponse.json({ ok: true });
  if (isDisposableEmail(body?.contactEmail)) return NextResponse.json({ error: 'Please use a business email address.' }, { status: 400 });
  try {
    const r = await submitPublicApplication(body || {});
    notifyOwner(`New marketplace vendor application — ${body.tradeName || body.legalName}`,
      `<p>${esc(body.legalName)} (${esc(body.contactEmail)}) applied to sell on the marketplace. Review it under Admin → Marketplace.</p>`).catch(() => {});
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not submit your application.' }, { status: 400 });
  }
}
