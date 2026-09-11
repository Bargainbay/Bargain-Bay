// One-time OneDrive connect (admin only). Sends the owner to Microsoft's consent
// screen; Microsoft returns them to /api/admin/onedrive/callback with a code.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { oneDriveConfigured, oneDriveAuthUrl } from '../../../../../lib/onedrive';
import { linkToken } from '../../../../../lib/links';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!oneDriveConfigured()) {
    return NextResponse.json({ error: 'Microsoft keys are not set yet — add MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel and redeploy.' }, { status: 503 });
  }
  return NextResponse.redirect(oneDriveAuthUrl(linkToken('onedrive', 'connect')));
}
