// A business applies to sell on the marketplace. Public, so: honeypot, per-email and global
// throttles in Postgres (lib/vendor-admin.js), and it grants NOTHING — staff review every application.
import { NextResponse } from 'next/server';
import { honeypotTripped, isDisposableEmail, clientIp } from '../../../../lib/antifraud';
import { submitPublicApplication } from '../../../../lib/vendor-admin';
import { sellerStanding } from '../../../../lib/vendors';
import { getSession } from '../../../../lib/auth';
import { notifyOwner, esc } from '../../../../lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  // A bot gets the same answer a person would, so it learns nothing.
  if (honeypotTripped(body)) return NextResponse.json({ ok: true });
  // Account first: the application belongs to the signed-in account, and its email is the account's,
  // never one typed into the form, so approval can only ever open the portal for the person who applied.
  const session = await getSession();
  if (!session?.email) return NextResponse.json({ error: 'Create an account or sign in first, then send your application.' }, { status: 401 });
  if (isDisposableEmail(session.email)) return NextResponse.json({ error: 'Please use a business email address.' }, { status: 400 });
  try {
    const st = await sellerStanding(session.email);
    if (st.access) return NextResponse.json({ error: 'Your account already sells on Bargain Bay.' }, { status: 400 });
    if (st.application && st.application.status !== 'rejected') return NextResponse.json({ error: 'You already have an application with us.' }, { status: 400 });
    body = { ...body, contactEmail: session.email };
    const r = await submitPublicApplication(body, { ip: clientIp(req) });
    notifyOwner(`New marketplace vendor application — ${body.tradeName || body.legalName}`,
      `<p>${esc(body.legalName)} (${esc(body.contactEmail)}) applied to sell on the marketplace. Review it under Admin → Marketplace.</p>`).catch(() => {});
    return NextResponse.json({ ok: true, id: r.id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not submit your application.' }, { status: 400 });
  }
}
