// OAuth callback from Intuit: validates state, exchanges the code for tokens
// (stored in settings), kicks an initial expense sync, and lands the owner back
// on the Financial dashboard.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { qboExchangeCode, syncQboExpenses } from '../../../../../lib/qbo';
import { verifyLinkToken } from '../../../../../lib/links';
import { SITE_URL } from '../../../../../lib/site';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const back = (q) => NextResponse.redirect(`${SITE_URL}/admin/financial${q || ''}`);

export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error')) return back('?qbo=denied');
  if (!code || !realmId) return back('?qbo=missing');
  if (!verifyLinkToken('qbo', 'connect', state)) return back('?qbo=badstate');

  try {
    await qboExchangeCode(code, realmId);
    // First pull right away so the owner sees numbers, not an empty panel.
    // 90 days of history; the nightly sync keeps it current from here.
    const r = await syncQboExpenses({ days: 90 }).catch(() => null);
    return back(`?qbo=connected${r?.synced ? `&synced=${r.synced}` : ''}`);
  } catch (e) {
    console.error('qbo connect failed', e?.message || e);
    return back('?qbo=failed');
  }
}
