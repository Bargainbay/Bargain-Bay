// Kicks off the one-time QuickBooks OAuth connect (admin only). Redirects the
// owner's browser to Intuit's consent screen; Intuit sends them back to
// /api/admin/qbo/callback with a code.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { qboConfigured, qboAuthUrl } from '../../../../../lib/qbo';
import { linkToken } from '../../../../../lib/links';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!qboConfigured()) {
    return NextResponse.json({ error: 'QuickBooks keys are not set yet — add QBO_CLIENT_ID and QBO_CLIENT_SECRET in Vercel and redeploy.' }, { status: 503 });
  }
  // Stateless CSRF token, verified in the callback.
  return NextResponse.redirect(qboAuthUrl(linkToken('qbo', 'connect')));
}
