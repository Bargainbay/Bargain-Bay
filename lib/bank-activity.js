// Bank lines that are not expense rows, kept so the live list can show everything the bank reported today:
// pending lines, money in, and money out that is not a cost. See db/migrations/0056_bank_activity.sql.
import { query, hasDb } from './db';
import { upsertExpense } from './finance';

const DDL = `
CREATE TABLE IF NOT EXISTS bank_activity (
  id serial PRIMARY KEY, ext_id text NOT NULL UNIQUE, activity_date date NOT NULL, amount numeric(12,2) NOT NULL,
  pending boolean NOT NULL DEFAULT false, name text, description text, memo text, category text, account_label text,
  counterparty text, who_override text, note text, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE bank_activity ADD COLUMN IF NOT EXISTS income_category text;
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

// A settled money-out line the bank calls a TRANSFER (every TD e-transfer sent) is not an expense until a person says
// what it was. Choosing a category here turns it into an expense row (and takes it off the activity list), exactly as
// if it had arrived that way. Wages take no HST. Done per line, by a person, never in bulk: an e-transfer may be a
// supplier payment for stock (already costed through its purchase invoice), a draw, or a salary.
export async function promoteActivity(id, { category, by } = {}) {
  await ensureBankActivitySchema();
  const { rows } = await query(`SELECT * FROM bank_activity WHERE id = $1`, [Number(id)]);
  const a = rows[0];
  if (!a) throw new Error('That line is already sorted.');
  if (a.pending) throw new Error('That one is still pending at the bank. It can be sorted once it posts.');
  if (Number(a.amount) >= 0) throw new Error('Only money going out can be an expense.');
  const cat = String(category || '').trim();
  if (!cat) throw new Error('Choose a category.');
  const gross = c2(-Number(a.amount));
  const who = a.who_override || a.counterparty || a.name || 'Bank transfer';
  await upsertExpense({
    incurredOn: new Date(a.activity_date).toISOString().slice(0, 10), category: cat, vendor: who, amount: gross,
    tax: cat === 'Wages' ? 0 : null, note: a.account_label ? String(a.account_label) : 'Bank', extId: a.ext_id, source: 'plaid',
    payee: a.counterparty || null, bankDesc: a.description, memo: a.memo, accountLabel: a.account_label, catSource: 'manual'
  });
  await query(
    `UPDATE expenses SET reviewed_at = now(), reviewed_by = $2, cat_source = 'manual',
            payee_override = COALESCE(payee_override, $3) WHERE ext_id = $1`, [a.ext_id, by || null, a.who_override || null]);
  await query('DELETE FROM bank_activity WHERE id = $1', [a.id]);
  return { extId: a.ext_id, gross };
}

// One transfer that was really several things: $3,000 sent as $2,000 loan interest and $1,000 owner dividend. Each part
// becomes its own expense (ext_id <bank id>#1, #2 ...) and the parts must add up to the cent to what left the bank.
export async function splitActivity(id, { parts, by } = {}) {
  await ensureBankActivitySchema();
  const { rows } = await query(`SELECT * FROM bank_activity WHERE id = $1`, [Number(id)]);
  const a = rows[0];
  if (!a) throw new Error('That line is already sorted.');
  if (a.pending) throw new Error('That one is still pending at the bank. It can be sorted once it posts.');
  if (Number(a.amount) >= 0) throw new Error('Only money going out can be split into expenses.');
  const list = (Array.isArray(parts) ? parts : []).map((p) => ({ category: String(p.category || '').trim(), amount: c2(Number(p.amount)), note: String(p.note || '').trim() }));
  if (list.length < 2) throw new Error('A split needs at least two parts.');
  if (list.some((p) => !p.category || !(p.amount > 0))) throw new Error('Every part needs a category and an amount.');
  const gross = c2(-Number(a.amount));
  const sum = c2(list.reduce((t, p) => t + p.amount, 0));
  if (Math.abs(sum - gross) > 0.004) throw new Error(`The parts add up to ${sum.toFixed(2)} but the transfer was ${gross.toFixed(2)}.`);
  const who = a.who_override || a.counterparty || a.name || 'Bank transfer';
  const day = new Date(a.activity_date).toISOString().slice(0, 10);
  for (let i = 0; i < list.length; i++) {
    const p = list[i], extId = `${a.ext_id}#${i + 1}`;
    await upsertExpense({
      incurredOn: day, category: p.category, vendor: who, amount: p.amount, tax: p.category === 'Wages' ? 0 : null,
      note: p.note || (a.account_label ? String(a.account_label) : 'Bank'), extId, source: 'plaid',
      payee: a.counterparty || null, bankDesc: a.description, memo: a.memo, accountLabel: a.account_label, catSource: 'manual'
    });
    await query(`UPDATE expenses SET reviewed_at = now(), reviewed_by = $2, cat_source = 'manual', payee_override = COALESCE(payee_override, $3) WHERE ext_id = $1`,
      [extId, by || null, a.who_override || null]);
  }
  await query('DELETE FROM bank_activity WHERE id = $1', [a.id]);
  return { gross, parts: list.length };
}

// A split line is stored as <ext_id>#1, #2 ... so the bank re-sending the original must still find it.
export async function hasExpense(extId) {
  const { rowCount } = await query(`SELECT 1 FROM expenses WHERE ext_id = $1 OR left(ext_id, length($1) + 1) = $1 || '#' LIMIT 1`, [extId]);
  return rowCount > 0;
}
export async function isDecidedExpense(extId) {
  const { rows } = await query(`SELECT cat_source FROM expenses WHERE ext_id = $1 OR left(ext_id, length($1) + 1) = $1 || '#' LIMIT 1`, [extId]);
  return !!rows[0] && ['manual', 'bulk'].includes(rows[0].cat_source);
}

// What money coming IN was. A label on the bank line, not an expense: income never becomes an expense row.
export const INCOME_CATEGORIES = ['Product sale', 'Service sale', 'Deposit on an order', 'Refund or credit received', 'Loan or owner money in', 'Scrap or other sale'];
export async function sortIncome(id, { category, who } = {}) {
  await ensureBankActivitySchema();
  const cat = String(category || '').trim().replace(/\s+/g, ' ');
  if (cat.length > 60) throw new Error('Keep the category to 60 characters.');
  const { rows } = await query(`SELECT amount FROM bank_activity WHERE id = $1`, [Number(id)]);
  if (!rows[0]) throw new Error('That line could not be found.');
  if (Number(rows[0].amount) <= 0) throw new Error('Only money coming in can be labelled as income.');
  await query(`UPDATE bank_activity SET income_category = $2, who_override = COALESCE(NULLIF($3, ''), who_override) WHERE id = $1`,
    [Number(id), cat || null, who ? String(who).trim().slice(0, 120) : '']);
  return { id: Number(id), category: cat || null };
}
