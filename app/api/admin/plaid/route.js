// Bank feed (Plaid) — link, sync, disconnect. Admin-only: linking a bank
// account is an access grant, not a selling-surface action.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { createLinkToken, exchangePublicToken, syncPlaidTransactions, plaidDisconnect, plaidStatus } from '../../../../lib/plaid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A first pull can be two years of transactions across several accounts.
export const maxDuration = 60;

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    // The browser needs one of these before it can open Plaid Link. Passing an
    // itemId asks for a RE-AUTH token for a connection whose login has expired.
    if (b.action === 'link_token') {
      const s = await getSession();
      const token = await createLinkToken({ userId: s?.userId || s?.email || 'owner', itemId: b.itemId || null });
      return NextResponse.json({ ok: true, linkToken: token });
    }
    // Plaid Link succeeded in the browser; swap its public token for ours and
    // pull straight away, so the ledger is populated before the page reloads.
    if (b.action === 'exchange') {
      const r = await exchangePublicToken(b.publicToken);
      const sync = await syncPlaidTransactions().catch((e) => ({ error: e.message }));
      return NextResponse.json({ ok: true, ...r, sync });
    }
    if (b.action === 'sync') {
      const r = await syncPlaidTransactions();
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'disconnect') {
      await plaidDisconnect(b.itemId);
      return NextResponse.json({ ok: true, disconnected: true });
    }
    if (b.action === 'status') return NextResponse.json({ ok: true, status: await plaidStatus() });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Plaid request failed.' }, { status: 500 });
  }
}
