// Bank lines that are not expense rows, kept so the live list can show everything the bank reported today:
// pending lines, money in, and money out that is not a cost. See db/migrations/0056_bank_activity.sql.
import { query, hasDb } from './db';

const DDL = `
CREATE TABLE IF NOT EXISTS bank_activity (
  id serial PRIMARY KEY, ext_id text NOT NULL UNIQUE, activity_date date NOT NULL, amount numeric(12,2) NOT NULL,
  pending boolean NOT NULL DEFAULT false, name text, description text, memo text, category text, account_label text,
  counterparty text, who_override text, note text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_bank_activity_date ON bank_activity (activity_date DESC, id DESC);`;
let ready = false;
export async function ensureBankActivitySchema() { if (ready) return; await query(DDL); ready = true; }

const c2 = (v) => Math.round(Number(v) * 100) / 100;

/**
 * One Plaid transaction → a bank_activity row. Plaid's sign: POSITIVE is money leaving, so it is flipped here
 * (in = positive). Returns null for something with no date or amount.
 */
export function mapActivity(t, accounts = null) {
  if (!t || !t.date) return null;
  const raw = Number(t.amount);
  if (!Number.isFinite(raw) || raw === 0) return null;
  const pm = t.payment_meta || {};
  const cps = Array.isArray(t.counterparties) ? t.counterparties.filter((c) => c && c.name) : [];
  const acct = accounts && t.account_id ? accounts.get(t.account_id) : null;
  return {
    extId: `plaid:${t.transaction_id}`,
    date: t.date,
    amount: c2(-raw),
    pending: !!t.pending,
    name: String(t.merchant_name || t.name || '').slice(0, 160) || null,
    description: String(t.original_description || t.name || '').slice(0, 300) || null,
    memo: pm.reason ? String(pm.reason).slice(0, 300) : null,
    category: t.personal_finance_category?.primary || null,
    accountLabel: acct || null,
    counterparty: (cps.find((c) => c.type === 'merchant') || cps[0] || {}).name || null
  };
}

export async function recordActivity(a) {
  if (!hasDb() || !a) return;
  await ensureBankActivitySchema();
  await query(
    `INSERT INTO bank_activity (ext_id, activity_date, amount, pending, name, description, memo, category, account_label, counterparty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (ext_id) DO UPDATE SET activity_date = EXCLUDED.activity_date, amount = EXCLUDED.amount, pending = EXCLUDED.pending,
       name = EXCLUDED.name, description = EXCLUDED.description, memo = EXCLUDED.memo, category = EXCLUDED.category,
       account_label = EXCLUDED.account_label, counterparty = EXCLUDED.counterparty, updated_at = now()`,
    [a.extId, a.date, a.amount, a.pending, a.name, a.description, a.memo, a.category, a.accountLabel, a.counterparty]);
}

export async function deleteActivity(extId) {
  if (!hasDb() || !extId) return;
  await ensureBankActivitySchema();
  await query('DELETE FROM bank_activity WHERE ext_id = $1', [extId]);
}
