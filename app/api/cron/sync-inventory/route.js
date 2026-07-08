import { NextResponse } from 'next/server';
import { syncInventoryFromTracker } from '../../../../lib/catalog-sync';
import { backfillAllInvoiceOrders } from '../../../../lib/invoices';
import { watchInvoiceInbox } from '../../../../lib/intake-watch';
import { postDueRecurringExpenses } from '../../../../lib/finance';
import { sendWeeklyFinanceBrief } from '../../../../lib/finance-report';
import { syncQboExpenses } from '../../../../lib/qbo';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Nightly inventory sync + self-healing revenue reconcile. Driven by Vercel Cron
// (vercel.json). If CRON_SECRET is set, require it (Vercel Cron sends
// Authorization: Bearer <CRON_SECRET>).
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
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
  // Watch the intake inbox for purchase invoices → review queue. Best-effort.
  let intake = null;
  try { intake = await watchInvoiceInbox(); } catch (e) { console.error('cron intake-watch failed', e?.message || e); }

  // Post any recurring expenses (rent/storage/subscriptions) due this cycle, so
  // fixed costs land in the P&L without anyone remembering. Best-effort.
  let recurringPosted = 0;
  try {
    const r = await postDueRecurringExpenses();
    recurringPosted = r.posted;
    if (r.posted) console.log('cron recurring expenses posted', JSON.stringify(r.details));
  } catch (e) { console.error('cron recurring expenses failed', e?.message || e); }

  // Pull expenses from QuickBooks (bank-feed transactions) so the ledger stays
  // current with zero manual entry. No-ops until QBO is connected. Runs BEFORE
  // the Monday brief so the week's numbers include the freshest expenses.
  let qbo = null;
  try {
    const r = await syncQboExpenses();
    if (r.configured) qbo = { synced: r.synced, errors: r.errors?.length || 0 };
    if (r.errors?.length) console.error('cron qbo sync issues', JSON.stringify(r.errors));
  } catch (e) { console.error('cron qbo sync failed', e?.message || e); }

  // Mondays (Toronto): send last week's P&L to the management Telegram group.
  // Once per week (settings-key dedupe); no-ops quietly on other days.
  let brief = null;
  try { brief = await sendWeeklyFinanceBrief(); } catch (e) { console.error('cron finance brief failed', e?.message || e); }

  try {
    const result = await syncInventoryFromTracker();
    return NextResponse.json({ ok: true, reconciled: fixed, intake, recurringPosted, qbo, brief, ...result });
  } catch (e) {
    console.error('cron sync-inventory failed', e?.message || e);
    return NextResponse.json({ ok: false, reconciled: fixed, recurringPosted, qbo, brief, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
