// Operating expenses + ad spend capture (self-provisioning tables). Powers the
// Financial (net profit / cash) and Marketing (ROAS / cost-per-lead) dashboards.
import { query, hasDb } from './db';

let ensured = null;
export async function ensureFinanceSchema() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = Promise.all([
    query(`CREATE TABLE IF NOT EXISTS expenses (
      id serial PRIMARY KEY,
      incurred_on date NOT NULL,
      category text,
      vendor text,
      amount numeric(10,2) NOT NULL,
      note text,
      created_at timestamptz DEFAULT now()
    )`),
    query(`CREATE TABLE IF NOT EXISTS ad_spend (
      id serial PRIMARY KEY,
      spent_on date NOT NULL,
      channel text NOT NULL,
      amount numeric(10,2) NOT NULL,
      campaign text,
      note text,
      created_at timestamptz DEFAULT now()
    )`)
  ]).then(() => Promise.all([
    // 'manual' rows are owner-entered; 'meta' rows are synced and de-duped by ext_id.
    query(`ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'`),
    query('ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS ext_id text'),
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_ext ON ad_spend(ext_id) WHERE ext_id IS NOT NULL'),
    // Recurring templates (rent, storage, subscriptions) that the nightly cron
    // auto-posts into expenses — so fixed costs count without anyone remembering.
    query(`CREATE TABLE IF NOT EXISTS recurring_expenses (
      id serial PRIMARY KEY,
      category text,
      vendor text,
      amount numeric(10,2) NOT NULL,
      cadence text NOT NULL DEFAULT 'monthly',  -- 'monthly' (on day_of, 1-28) | 'weekly' (every Monday)
      day_of int DEFAULT 1,
      note text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz DEFAULT now()
    )`),
    // Links an auto-posted expense row back to its template (also the de-dupe key
    // together with incurred_on, so a re-run never double-posts a cycle).
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurring_id int'),
    // Synced rows (QuickBooks bank feed) are de-duped/updated by ext_id; owner
    // 'manual' rows are never touched by a sync.
    query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'`),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ext_id text'),
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ext ON expenses(ext_id) WHERE ext_id IS NOT NULL')
  ])).catch((e) => { ensured = null; throw e; });
  return ensured;
}

export const EXPENSE_CATEGORIES = ['Rent / storage', 'Fuel / delivery', 'Wages', 'Tools / supplies', 'Fees', 'Marketing', 'Other'];
export const AD_CHANNELS = ['Meta', 'Google', 'Kijiji', 'Flyer / print', 'Other'];

const n = (v) => Number(v || 0);

// ── Expenses ────────────────────────────────────────────────────────────────
export async function listExpenses(limit = 100) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query('SELECT * FROM expenses ORDER BY incurred_on DESC, id DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ id: r.id, incurredOn: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null, category: r.category, vendor: r.vendor, amount: n(r.amount), note: r.note, source: r.source || 'manual' }));
}
export async function addExpense({ incurredOn, category, vendor, amount, note }) {
  await ensureFinanceSchema();
  const { rows } = await query(
    'INSERT INTO expenses (incurred_on, category, vendor, amount, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [incurredOn, category || null, vendor || null, n(amount), note || null]
  );
  return rows[0].id;
}
export async function deleteExpense(id) {
  await ensureFinanceSchema();
  await query('DELETE FROM expenses WHERE id = $1', [id]);
  return true;
}

// Idempotent upsert for synced rows (QuickBooks). Re-running a sync updates the
// row in place (date/category/vendor/amount follow QBO edits) instead of
// duplicating it. Owner-entered rows (no ext_id) are never touched.
export async function upsertExpense({ incurredOn, category, vendor, amount, note, extId, source = 'qbo' }) {
  await ensureFinanceSchema();
  if (!extId) throw new Error('upsertExpense needs an extId.');
  await query(
    `INSERT INTO expenses (incurred_on, category, vendor, amount, note, source, ext_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (ext_id) WHERE ext_id IS NOT NULL
     DO UPDATE SET incurred_on = EXCLUDED.incurred_on, category = EXCLUDED.category,
                   vendor = EXCLUDED.vendor, amount = EXCLUDED.amount, note = EXCLUDED.note`,
    [incurredOn, category || null, vendor || null, Number(amount) || 0, note || null, source, extId]
  );
}

// ── Recurring expenses ──────────────────────────────────────────────────────
// Fixed costs (rent, storage, subscriptions) set once and auto-posted by the
// nightly cron: monthly on day_of (1–28), or weekly every Monday. Auto-posted
// rows land in the normal expenses ledger (recurring_id links them back).
export async function listRecurringExpenses() {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query('SELECT * FROM recurring_expenses WHERE active ORDER BY id');
  return rows.map((r) => ({
    id: r.id, category: r.category, vendor: r.vendor, amount: n(r.amount),
    cadence: r.cadence === 'weekly' ? 'weekly' : 'monthly',
    dayOf: Number(r.day_of) || 1, note: r.note
  }));
}

export async function addRecurringExpense({ category, vendor, amount, cadence, dayOf, note }) {
  await ensureFinanceSchema();
  const amt = n(amount);
  if (!(amt > 0)) throw new Error('Amount must be positive.');
  const cad = cadence === 'weekly' ? 'weekly' : 'monthly';
  // Cap monthly at 28 so every month has the day (no skipped Feb rent).
  const day = cad === 'monthly' ? Math.min(Math.max(parseInt(dayOf, 10) || 1, 1), 28) : 1;
  const { rows } = await query(
    'INSERT INTO recurring_expenses (category, vendor, amount, cadence, day_of, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [category || null, vendor || null, amt, cad, day, note || null]
  );
  return rows[0].id;
}

export async function deleteRecurringExpense(id) {
  await ensureFinanceSchema();
  // Deactivate rather than delete — already-posted expense rows keep their link.
  await query('UPDATE recurring_expenses SET active = false WHERE id = $1', [id]);
  return true;
}

// Post any recurring expense whose current cycle is due and not yet posted.
// Runs daily from the nightly cron; catches up late (a missed cron posts the
// cycle on the next run, dated to the real due date). Idempotent per cycle via
// (recurring_id, incurred_on).
export async function postDueRecurringExpenses() {
  if (!hasDb()) return { posted: 0 };
  await ensureFinanceSchema();
  const { rows: recs } = await query('SELECT * FROM recurring_expenses WHERE active');
  if (!recs.length) return { posted: 0 };

  // Store-local "today" (Toronto), as YYYY-MM-DD parts.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const [y, m, d] = today.split('-').map(Number);

  let posted = 0;
  const details = [];
  for (const r of recs) {
    // Most recent due date <= today for this template's cadence.
    let due;
    if (r.cadence === 'weekly') {
      // Weekly = every Monday. Date.UTC keeps the calendar math off the server TZ.
      const t = new Date(Date.UTC(y, m - 1, d));
      const dow = t.getUTCDay(); // 0 Sun … 6 Sat
      t.setUTCDate(t.getUTCDate() - ((dow + 6) % 7)); // back to Monday
      due = t.toISOString().slice(0, 10);
    } else {
      const day = Math.min(Math.max(Number(r.day_of) || 1, 1), 28);
      if (d >= day) due = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      else {
        const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
        due = `${py}-${String(pm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    const { rows: ex } = await query(
      'SELECT 1 FROM expenses WHERE recurring_id = $1 AND incurred_on = $2 LIMIT 1', [r.id, due]
    );
    if (ex.length) continue;
    await query(
      'INSERT INTO expenses (incurred_on, category, vendor, amount, note, recurring_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [due, r.category, r.vendor, n(r.amount), r.note || `Recurring (${r.cadence})`, r.id]
    );
    posted++;
    details.push({ vendor: r.vendor || r.category || 'expense', amount: n(r.amount), on: due });
  }
  return { posted, details };
}

// ── Ad spend ────────────────────────────────────────────────────────────────
export async function listAdSpend(limit = 100) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query('SELECT * FROM ad_spend ORDER BY spent_on DESC, id DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ id: r.id, spentOn: r.spent_on ? new Date(r.spent_on).toISOString().slice(0, 10) : null, channel: r.channel, amount: n(r.amount), campaign: r.campaign, note: r.note }));
}
export async function addAdSpend({ spentOn, channel, amount, campaign, note }) {
  await ensureFinanceSchema();
  const { rows } = await query(
    "INSERT INTO ad_spend (spent_on, channel, amount, campaign, note, source) VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id",
    [spentOn, channel || 'Other', n(amount), campaign || null, note || null]
  );
  return rows[0].id;
}

// Idempotent upsert for synced rows (Meta). De-dupes on ext_id so re-running a
// sync never double-counts; owner 'manual' rows are never touched.
export async function upsertAdSpend({ spentOn, channel, amount, campaign, extId, source = 'meta' }) {
  await ensureFinanceSchema();
  await query(
    `INSERT INTO ad_spend (spent_on, channel, amount, campaign, source, ext_id)
       VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (ext_id) WHERE ext_id IS NOT NULL
     DO UPDATE SET spent_on = EXCLUDED.spent_on, amount = EXCLUDED.amount, campaign = EXCLUDED.campaign`,
    [spentOn, channel, n(amount), campaign || null, source, extId]
  );
}
export async function deleteAdSpend(id) {
  await ensureFinanceSchema();
  await query('DELETE FROM ad_spend WHERE id = $1', [id]);
  return true;
}
