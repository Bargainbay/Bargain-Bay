import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { sendEmail, emailConfigured } from '../../../../lib/email';

export const dynamic = 'force-dynamic';

// Admin-only: fire a real test email and report exactly what Resend said, so
// the owner can confirm (or debug) email delivery without reading server logs.
export async function POST() {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  const to = process.env.NOTIFY_EMAIL || session.email;
  const result = await sendEmail({
    to,
    subject: 'Bargain Bay — email test ✅',
    html: `<div style="font-family:Arial,sans-serif;color:#2e2d2b">
      <h2>Email is working</h2>
      <p>If you're reading this, Resend is configured correctly and order/member notifications will send.</p>
    </div>`
  });
  return NextResponse.json({
    configured: emailConfigured(),
    from: process.env.RESEND_FROM || '(default: onboarding@resend.dev — set RESEND_FROM to your domain)',
    to,
    result
  });
}
