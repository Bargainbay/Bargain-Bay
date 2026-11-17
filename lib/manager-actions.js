// What the manager DOES, not just says. The owner's instruction (2026-11-16):
// "act, report after" — so internal, reversible, non-money work happens without
// a yes, and every bit of it is written down and read back to him afterwards.
//
// THE LINE, and it is the whole design:
//   ACTS ON ITS OWN (here): put confirmed delivery orders on the dispatch board,
//     raise follow-up tasks for expiring quotes and overdue invoices, tell the
//     dispatch desk about stops with no driver, refresh stale stock, and — when
//     the owner tells it to — put a named driver on a named stop or raise a task.
//     All of it is internal, visible on a screen, and undone with a click.
//   NEVER, with no tool and a test that fails if one appears: money in or out,
//     refunds, invoices, prices, anything sent to a CUSTOMER, cost figures,
//     blocking or paying anybody. Those still need a person on the screen.
//
// EVERYTHING IT DOES IS LOGGED (`manager_actions`) and reported: the opening line
// of the next call says what was done while he was away, and /admin/manager lists
// it. A manager that acts silently is the failure; one that acts and says so is
// what he asked for.
import { query, hasDb } from './db';
import { torontoDay } from './manager-business';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';

const BY = 'Manager (AI)';
const BY_EMAIL = 'manager@bargainbay.ca';
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

// NOT memoised: a module-level "done" flag would be wrong for every fresh test
// database (the same trap the checkout route's DDL helpers fell into). It is
// idempotent DDL on a table that exists, so it costs next to nothing.
export function ensureActionSchema() {
  if (!hasDb()) return Promise.resolve();
  return query(`
    CREATE TABLE IF NOT EXISTS manager_actions (
      id serial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL,
      summary text NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      via text NOT NULL DEFAULT 'auto',        -- auto (unattended) | voice (owner told it to)
      dedupe_key text,
      reported_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_actions_dedupe ON manager_actions (dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_manager_actions_at ON manager_actions (at DESC);
  `);
}

// Record an action. With a dedupe key the SAME thing is never done twice (the
// unique index arbitrates, so two overlapping passes cannot both act). Returns
// false when it was already done.
export async function logAction({ kind, summary, detail = {}, via = 'auto', dedupeKey = null }) {
  await ensureActionSchema();
  const { rowCount } = await query(
    `INSERT INTO manager_actions (kind, summary, detail, via, dedupe_key)
     VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT DO NOTHING`,
    [kind, summary, JSON.stringify(detail), via, dedupeKey]);
  return rowCount > 0;
}

// What it did that he has not yet been told about.
export async function unreportedActions() {
  if (!hasDb()) return [];
  try {
    await ensureActionSchema();
    const { rows } = await query(
      `SELECT id, at, kind, summary, via FROM manager_actions WHERE reported_at IS NULL ORDER BY id DESC LIMIT 50`);
    return rows;
  } catch { return []; }
}
export async function markReported(ids = []) {
  if (!ids.length || !hasDb()) return;
  await query('UPDATE manager_actions SET reported_at = now() WHERE id = ANY($1::int[])', [ids.map(Number)]);
}
export async function recentActions(limit = 30) {
  if (!hasDb()) return [];
  try {
    await ensureActionSchema();
    return (await query('SELECT id, at, kind, summary, via, reported_at FROM manager_actions ORDER BY id DESC LIMIT $1', [limit])).rows;
  } catch { return []; }
}

// "Done N things while you were away" — arithmetic off the log, not the model.
export function reportLine(actions = []) {
  if (!actions.length) return '';
  const lines = actions.slice(0, 5).map((a) => a.summary);
  const more = actions.length > 5 ? `, and ${actions.length - 5} more` : '';
  return `While you were away I did ${plural(actions.length, 'thing')}: ${lines.join('; ')}${more}.`;
}

// ── Autonomous actions ──────────────────────────────────────────────────────

async function customerIdForEmail(email) {
  if (!email) return null;
  const { rows } = await query('SELECT id FROM customers WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return rows[0]?.id || null;
}

async function hasOpenTask(customerId, marker) {
  const { rows } = await query(
    `SELECT 1 FROM customer_tasks WHERE customer_id = $1 AND done_at IS NULL AND title LIKE $2 LIMIT 1`,
    [customerId, `%${marker}%`]);
  return rows.length > 0;
}

// Raise an UNASSIGNED follow-up (shows on everyone's My Day). One per document,
// ever: if its task is already open, nothing is added.
async function raiseTask({ email, marker, title, note, via = 'auto' }) {
  const customerId = await customerIdForEmail(email);
  if (!customerId) return { ok: false, why: 'no customer record for that email' };
  if (await hasOpenTask(customerId, marker)) return { ok: false, why: 'already has an open follow-up' };
  const { addTask } = await import('./crm');
  await addTask({ customerId, title, note, dueOn: torontoDay(), ownerEmail: null, createdBy: BY_EMAIL });
  return { ok: true };
}

// Quotes expiring within two days: one follow-up each.
export async function chaseQuotes() {
  const { rows } = await query(
    `SELECT number, name, email, total::float AS total, expires_at::text AS expires
       FROM quotes WHERE status = 'open' AND expires_at >= $1::date AND expires_at <= $2::date
      ORDER BY total DESC LIMIT 50`, [torontoDay(), torontoDay(2)]);
  const done = [];
  for (const q of rows) {
    const r = await raiseTask({
      email: q.email, marker: q.number,
      title: `Chase quote ${q.number} ($${Math.round(q.total)}) — expires ${q.expires}`,
      note: 'Raised by the manager: this quote expires within two days. Call them before it lapses.'
    }).catch(() => ({ ok: false }));
    if (r.ok) done.push(q.number);
  }
  if (done.length) await logAction({
    kind: 'chase_quotes', summary: `raised follow-ups for ${plural(done.length, 'expiring quote')}`,
    detail: { quotes: done }, dedupeKey: null
  });
  return { done };
}

// Invoices three or more days past due: one follow-up each.
export async function chaseReceivables() {
  const { rows } = await query(
    `SELECT number, name, email, total::float AS total, ($1::date - due_date)::int AS days_late
       FROM invoices WHERE status IN ('open','partial') AND due_date IS NOT NULL AND due_date <= ($1::date - 3)
      ORDER BY total DESC LIMIT 50`, [torontoDay()]);
  const done = [];
  for (const inv of rows) {
    const r = await raiseTask({
      email: inv.email, marker: inv.number,
      title: `Collect ${inv.number} ($${Math.round(inv.total)}) — ${inv.days_late} days past due`,
      note: 'Raised by the manager: this invoice is past its due date. Ring them and ask when it will be paid.'
    }).catch(() => ({ ok: false }));
    if (r.ok) done.push(inv.number);
  }
  if (done.length) await logAction({
    kind: 'chase_receivables', summary: `raised collection follow-ups for ${plural(done.length, 'overdue invoice')}`,
    detail: { invoices: done }, dedupeKey: null
  });
  return { done };
}

// Tell the dispatch desk, once a day, about tomorrow's stops with no driver.
export async function nudgeDispatch() {
  const tomorrow = torontoDay(1);
  const { rows } = await query(
    `SELECT job_number, customer_name FROM jobs
      WHERE driver_id IS NULL AND status NOT IN ('done','failed','cancelled') AND job_date = $1::date ORDER BY id LIMIT 50`, [tomorrow]);
  if (!rows.length) return { sent: false };
  const first = await logAction({
    kind: 'nudge_dispatch', summary: `told the dispatch desk ${plural(rows.length, 'stop')} tomorrow had no driver`,
    detail: { jobs: rows.map((r) => r.job_number) }, dedupeKey: `nudge-dispatch:${tomorrow}`
  });
  if (!first) return { sent: false, why: 'already told them today' };
  const list = rows.map((r) => `<li>${r.job_number} ${String(r.customer_name || '').replace(/</g, '&lt;')}</li>`).join('');
  await sendEmail({
    to: dispatchDesk(), subject: `${plural(rows.length, 'stop')} tomorrow with no driver`,
    html: `<p>${plural(rows.length, 'delivery stop')} for ${tomorrow} ${rows.length === 1 ? 'has' : 'have'} no driver yet:</p><ul>${list}</ul><p>Assign them on the dispatch board. — your Manager</p>`
  }).catch(() => {});
  return { sent: true, count: rows.length };
}

// Confirmed delivery orders with no stop → onto the board. The pull is
// idempotent and was always meant to be pressed by somebody; this is that person.
export async function pullOrders() {
  const { importReadyBargainBayOrders } = await import('./jobs');
  const r = await importReadyBargainBayOrders({ by: BY });
  if (r.imported) await logAction({
    kind: 'pull_orders', summary: `put ${plural(r.imported, 'delivery order')} on the dispatch board`,
    detail: { created: r.created }
  });
  return { imported: r.imported, skipped: (r.skipped || []).length };
}

// Stale stock from the tracker.
export async function refreshStock() {
  const { syncInventoryFromTracker } = await import('./catalog-sync');
  const r = await syncInventoryFromTracker();
  await logAction({ kind: 'sync_inventory', summary: 'refreshed the website stock from the tracker', detail: { upserted: r.upserted ?? null } });
  return r;
}

const REMEDIES = {
  chase_quotes: chaseQuotes,
  chase_receivables: chaseReceivables,
  nudge_dispatch: nudgeDispatch,
  pull_orders: pullOrders,
  run_inventory_sync: refreshStock
};

// The unattended pass: for every live issue that names a remedy, run it. Each
// remedy is independent and caught — one failing is a log line, not a reason to
// skip the rest (same rule as the nightly pass).
export async function runAutoActions(issues = [], { dry = false } = {}) {
  const wanted = [...new Set(issues.map((i) => i.fix).filter((f) => REMEDIES[f]))];
  const results = {};
  for (const fix of wanted) {
    if (dry) { results[fix] = { dry: true }; continue; }
    try { results[fix] = await REMEDIES[fix](); }
    catch (e) { console.error(`manager action ${fix} failed`, e?.message || e); results[fix] = { error: e?.message || String(e) }; }
  }
  return results;
}

// ── Things the owner tells it to do by voice (act now, report after) ────────

export async function listDriverOptions() {
  const { rows } = await query('SELECT id, name FROM users WHERE is_driver = true ORDER BY name NULLS LAST');
  return rows;
}

// Put a named driver on a stop. Names are matched, never guessed: zero or several
// matches is an answer, not a pick.
export async function assignStopByName({ jobNumber, driverName, jobDate }) {
  const { rows: jobs } = await query('SELECT id, job_number, customer_name, status FROM jobs WHERE upper(job_number) = upper($1)', [String(jobNumber || '').trim()]);
  if (!jobs.length) return { error: `I cannot find a stop numbered ${jobNumber}.` };
  const drivers = (await listDriverOptions()).filter((d) => String(d.name || '').toLowerCase().includes(String(driverName || '').trim().toLowerCase()));
  if (!drivers.length) return { error: `I do not have a driver called ${driverName}.` };
  if (drivers.length > 1) return { error: `More than one driver matches ${driverName}: ${drivers.map((d) => d.name).join(', ')}. Which one?` };
  const { assignJob } = await import('./jobs');
  const patch = { driverId: drivers[0].id };
  if (jobDate) patch.jobDate = jobDate;
  try { await assignJob(jobs[0].id, patch, BY); }
  catch (e) { return { error: e.message || 'That did not work.' }; }
  await logAction({
    kind: 'assign_stop', via: 'voice',
    summary: `put ${drivers[0].name} on ${jobs[0].job_number}${jobs[0].customer_name ? ` (${jobs[0].customer_name})` : ''}`,
    detail: { job: jobs[0].job_number, driver: drivers[0].name, jobDate: jobDate || null }
  });
  return { ok: true, said: `${drivers[0].name} is now on ${jobs[0].job_number}` };
}

// A follow-up task against a customer found by name or email. Several matches
// is a question back, not a pick.
export async function addFollowUpByName({ customer, title, dueOn }) {
  const q = String(customer || '').trim();
  if (!q) return { error: 'Which customer?' };
  const { rows } = await query(
    `SELECT id, name, email FROM customers WHERE lower(email) = lower($1) OR lower(name) LIKE lower($2) ORDER BY id DESC LIMIT 6`,
    [q, `%${q}%`]);
  if (!rows.length) return { error: `I do not have a customer called ${q}.` };
  if (rows.length > 1) return { error: `Several customers match ${q}: ${rows.map((r) => r.name || r.email).join(', ')}. Which one?` };
  const { addTask } = await import('./crm');
  await addTask({ customerId: rows[0].id, title, dueOn: dueOn || torontoDay(1), ownerEmail: null, createdBy: BY_EMAIL });
  await logAction({
    kind: 'add_followup', via: 'voice',
    summary: `raised a follow-up for ${rows[0].name || rows[0].email}: ${String(title).slice(0, 80)}`,
    detail: { customerId: rows[0].id, title, dueOn: dueOn || torontoDay(1) }
  });
  return { ok: true, said: `follow-up raised for ${rows[0].name || rows[0].email}` };
}

// A one-shot picture of the business for "how are we doing?" — counts, no cost.
export async function businessSnapshot() {
  const today = torontoDay();
  const one = async (sql, args = []) => { try { return (await query(sql, args)).rows[0] || {}; } catch { return {}; } };
  const sales = await one(
    `SELECT count(*)::int AS orders, COALESCE(sum(subtotal - COALESCE(vendor_subtotal,0)),0)::float AS revenue
       FROM orders WHERE (created_at AT TIME ZONE 'America/Toronto')::date = $1::date AND status NOT IN ('cancelled','refunded')`, [today]);
  const board = await one(
    `SELECT count(*)::int AS stops, count(*) FILTER (WHERE status = 'done')::int AS done,
            count(*) FILTER (WHERE status IN ('failed'))::int AS failed,
            count(*) FILTER (WHERE driver_id IS NULL AND status NOT IN ('done','failed','cancelled'))::int AS unassigned
       FROM jobs WHERE job_date = $1::date AND status <> 'cancelled'`, [today]);
  const ar = await one(
    `SELECT count(*)::int AS n, COALESCE(sum(total),0)::float AS total FROM invoices WHERE status IN ('open','partial') AND due_date < $1::date`, [today]);
  const stock = await one(`SELECT count(*)::int AS live FROM products WHERE active = true`);
  return {
    today,
    sales: { orders: sales.orders ?? null, revenuePreTax: sales.revenue != null ? Math.round(sales.revenue) : null },
    deliveries: { stops: board.stops ?? null, done: board.done ?? null, failed: board.failed ?? null, unassigned: board.unassigned ?? null },
    receivables: { overdueInvoices: ar.n ?? null, overdueTotal: ar.total != null ? Math.round(ar.total) : null },
    stockLive: stock.live ?? null
  };
}
