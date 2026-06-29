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
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_ext ON ad_spend(ext_id) WHERE ext_id IS NOT NULL')
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
  return rows.map((r) => ({ id: r.id, incurredOn: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null, category: r.category, vendor: r.vendor, amount: n(r.amount), note: r.note }));
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
