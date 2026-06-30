import { NextResponse } from 'next/server';
import { syncInventoryFromTracker } from '../../../../lib/catalog-sync';
import { backfillAllInvoiceOrders } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Nightly inventory sync + self-healing revenue reconcile. Driven by Vercel Cron
// (vercel.json). If CRON_SECRET is set, require it (Vercel Cron sends
// Authorization: Bearer <CRON_SECRET>).
async function run(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const key = new URL(req.url).searchParams.get('key') || '';
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }
  }
  // Self-heal: back-fill the fulfilment order for any paid invoice missing one, so
  // a paid sale always lands in the dashboard with zero manual action (covers a
  // transient hiccup in the live mark-paid path, or legacy invoices). Best-effort
  // — a reconcile failure must not block the inventory sync.
  // Counts only in the response (no customer data); full detail goes to logs.
  let fixed = 0;
  try {
    const r = await backfillAllInvoiceOrders();
    fixed = r.fixed;
    if (r.fixed) console.log('cron reconcile: added', r.fixed, 'paid invoice(s) to the dashboard', JSON.stringify(r.created));
    if (r.failed?.length) console.error('cron reconcile failures', JSON.stringify(r.failed));
  } catch (e) {
    console.error('cron invoice reconcile failed', e?.message || e);
  }
  try {
    const result = await syncInventoryFromTracker();
    return NextResponse.json({ ok: true, reconciled: fixed, ...result });
  } catch (e) {
    console.error('cron sync-inventory failed', e?.message || e);
    return NextResponse.json({ ok: false, reconciled: fixed, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
