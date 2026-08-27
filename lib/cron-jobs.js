// What the scheduled jobs actually do, separated from the routes that trigger
// them.
//
// WHY THIS EXISTS: the orchestration used to live inline in the route files, so
// there was nowhere to run a job from except its own HTTP endpoint, and each
// route re-implemented the same "try this, log it, carry on" scaffolding. As
// plain functions they can be composed — `/api/cron/nightly` runs the lot in one
// request for catching up after an outage — and the error handling is written
// once.
//
// The three jobs stay SEPARATELY SCHEDULED (see vercel.json). Each scheduled
// invocation gets its own function time budget; running all three in one would
// give the set what one of them gets alone, and the finance pass is already the
// long one.
import { expireReservations } from './reservations';
import { syncMetaAds } from './meta-ads';
import { syncInventoryFromTracker } from './catalog-sync';
import { backfillAllInvoiceOrders } from './invoices';
import { watchInvoiceInbox } from './intake-watch';
import { postDueRecurringExpenses } from './finance';
import { sendWeeklyFinanceBrief } from './finance-report';
import { syncQboExpenses } from './qbo';
import { syncPlaidTransactions } from './plaid';
import { backfillCustomers } from './customers';

// Run a step without letting it take the whole invocation down with it. A cron
// pass is a sequence of independent chores: one failing is a log line, not a
// reason for the rest not to happen.
async function step(name, fn, fallback = null) {
  try {
    return await fn();
  } catch (e) {
    console.error(`cron ${name} failed`, e?.message || e);
    return fallback;
  }
}

// Cap a step that talks to somebody else's API. Without this a hanging call to
// Meta or Intuit eats the function's whole time limit and the work AFTER it —
// which is the work that matters — never happens.
function withTimeout(name, promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms))
  ]);
}

// ---- the jobs -------------------------------------------------------------

// Free units held by checkouts nobody finished, and cancel genuinely abandoned
// unpaid orders. Cheap, and time-sensitive: every minute this doesn't run is a
// minute a purchasable unit is off the site.
export function runExpireReservations() {
  return expireReservations();
}

// Meta ad spend into the ledger. No-ops until the Meta vars are configured.
export function runAdSync() {
  return syncMetaAds();
}

// The nightly finance + inventory pass. The heavy one: several external APIs
// and a full tracker read. Every step is independently guarded, and the order is
// deliberate — money-in-the-ledger work happens BEFORE the Monday brief that
// reports on it, and the tracker sync goes last because it's the longest.
export async function runNightlyOps() {
  // Self-heal: back-fill the fulfilment order for any paid invoice missing one,
  // so a paid sale always lands on the dashboard with zero manual action.
  const reconcile = await step('invoice reconcile', async () => {
    const r = await backfillAllInvoiceOrders();
    if (r.fixed) console.log('cron reconcile: added', r.fixed, 'paid invoice(s) to the dashboard', JSON.stringify(r.created));
    if (r.failed?.length) console.error('cron reconcile failures', JSON.stringify(r.failed));
    return r.fixed;
  }, 0);

  // Purchase invoices arriving by email → the review queue.
  const intake = await step('intake-watch', () => watchInvoiceInbox());

  // Rent, storage, subscriptions — so fixed costs land without anyone remembering.
  const recurringPosted = await step('recurring expenses', async () => {
    const r = await postDueRecurringExpenses();
    if (r.posted) console.log('cron recurring expenses posted', JSON.stringify(r.details));
    return r.posted;
  }, 0);

  // Expenses from QuickBooks, then the bank feed. Both before the brief, so the
  // week's numbers include the freshest spending. Both no-op until connected.
  const qbo = await step('qbo sync', async () => {
    const r = await withTimeout('qbo sync', syncQboExpenses(), 20000);
    if (r.errors?.length) console.error('cron qbo sync issues', JSON.stringify(r.errors));
    return r.configured ? { synced: r.synced, errors: r.errors?.length || 0 } : null;
  });

  const bank = await step('bank sync', async () => {
    const r = await withTimeout('bank sync', syncPlaidTransactions(), 25000);
    if (r.errors?.length) console.error('cron bank sync issues', JSON.stringify(r.errors));
    return r.configured && r.connected ? { added: r.added, updated: r.updated, removed: r.removed } : null;
  });

  // Converge the client database with history.
  const crm = await step('customer backfill', async () => (await backfillCustomers()).customers ?? null);

  // Mondays (Toronto): last week's P&L to the management group. Dedupes itself.
  const brief = await step('finance brief', () => sendWeeklyFinanceBrief());

  // Last, and the only one allowed to report failure: everything above is
  // best-effort housekeeping, but stock going stale is what customers see.
  const inventory = await syncInventoryFromTracker();
  return { reconciled: reconcile, intake, recurringPosted, qbo, bank, crm, brief, ...inventory };
}

// ---- the one scheduled pass ----------------------------------------------

// Everything, back to back, in one request. Not the schedule — this is the
// catch-up path. Cheapest and most time-sensitive first, each capped, so a slow
// external API can't starve the work behind it: the failure mode to avoid is the
// finance pass being crowded out by a hanging call to somebody else's ad
// platform.
export async function runNightly() {
  const reservations = await step('expire-reservations',
    () => withTimeout('expire-reservations', runExpireReservations(), 15000));
  const ads = await step('ad sync',
    () => withTimeout('ad sync', runAdSync(), 15000));
  const ops = await step('nightly ops', () => runNightlyOps());
  return { reservations, ads, ops };
}
