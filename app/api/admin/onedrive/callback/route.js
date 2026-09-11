// OAuth callback from Microsoft: validates state, exchanges the code for tokens,
// and lands the owner back on dispatch.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { oneDriveExchangeCode } from '../../../../../lib/onedrive';
import { verifyLinkToken } from '../../../../../lib/links';
import { brandFor } from '../../../../../lib/brands';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Back to the RS host, not the storefront — this is dispatch's connection.
const back = (q) => NextResponse.redirect(`${brandFor('rs_solutions').url()}/admin/dispatch?view=setup${q || ''}`);

export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return back('&onedrive=denied');
  const code = url.searchParams.get('code');
  if (!code) return back('&onedrive=missing');
  if (!verifyLinkToken('onedrive', 'connect', url.searchParams.get('state'))) return back('&onedrive=badstate');

  try {
    await oneDriveExchangeCode(code);
    return back('&onedrive=connected');
  } catch (e) {
    console.error('onedrive connect failed', e?.message || e);
    return back('&onedrive=failed');
  }
}
