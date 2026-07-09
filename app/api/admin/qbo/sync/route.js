// Manual "Sync now" for QuickBooks expenses + disconnect. Admin only. The
// nightly cron does this automatically; the button is for "I just categorized
// things in QBO, show me now".
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { syncQboExpenses, qboStatus, qboDisconnect } from '../../../../../lib/qbo';
import { query } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json(await qboStatus());
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'disconnect') {
      await qboDisconnect();
      return NextResponse.json({ ok: true, disconnected: true });
    }
    // Wipe every QuickBooks-synced expense row (used when switching from the
    // sandbox test company to the real books, so fake data never pollutes the
    // P&L). Owner-entered and recurring rows are untouched.
    if (b.action === 'purge_synced') {
      const r = await query("DELETE FROM expenses WHERE ext_id LIKE 'qbo:%'");
      return NextResponse.json({ ok: true, purged: r.rowCount || 0 });
    }
    const days = Math.min(Math.max(parseInt(b.days, 10) || 60, 1), 365);
    const r = await syncQboExpenses({ days });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Sync failed.' }, { status: 500 });
  }
}
