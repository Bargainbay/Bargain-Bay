import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { sendEmail, emailConfigured } from '../../../../lib/email';
import { brandFor, BRANDS } from '../../../../lib/brands';

export const dynamic = 'force-dynamic';

// Admin-only: fire a real test email and report exactly what Resend said, so the
// owner can confirm (or debug) delivery without reading server logs.
//
// Takes a brand, because the two businesses send from different domains and a
// working Bargain Bay send tells you nothing about whether RS Solutions can
// send. Finding that out by mailing a real client their first invoice is not the
// way to find it out.
export async function POST(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const B = brandFor(BRANDS[body.brand] ? body.brand : 'bargain_bay');

  const to = process.env.NOTIFY_EMAIL || session.email;
  const result = await sendEmail({
    to,
    brand: B.key,
    subject: `${B.name} — email test`,
    html: `<div style="font-family:Arial,sans-serif;color:#2e2d2b">
      <h2>${B.name} email is working</h2>
      <p>This went out as <b>${B.name}</b>. If you can read it, invoices sent under that
      name will reach their clients, and replies come back to ${B.contactEmail}.</p>
    </div>`
  });
  return NextResponse.json({
    configured: emailConfigured(),
    brand: B.key,
    from: B.from(),
    replyTo: B.contactEmail,
    to,
    result
  });
}
