// Operating expenses + ad spend capture (self-provisioning tables). Powers the
// Financial (net profit / cash) and Marketing (ROAS / cost-per-lead) dashboards.
import { query, hasDb, withTransaction } from './db';
import { getSetting, setSetting } from './settings';
import { LEDGER_START_DEFAULT, round2 } from './constants';
import { splitGross } from './tax';
import { payeeKey, payeeLabel, rulePrefix } from './payee';

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
    // Which business the spend belongs to; NULL = not yet assigned.
    query('ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS brand text'),
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
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ext ON expenses(ext_id) WHERE ext_id IS NOT NULL'),
    // HST PAID — the input tax credit side of a remittance. `amount` stays the
    // pre-tax cost (that's what the P&L wants); `tax` is the recoverable half,
    // and NULL means "nobody has said yet", which is different from zero. The
    // remittance panel reports how much of the ledger is still null rather than
    // quietly treating unreviewed spending as tax-free.
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax numeric(10,2)'),
    query('ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS tax numeric(10,2)'),
    // Who it went to, what the bank said, and whether a person has looked at it
    // (migration 0052 carries the same columns; both are idempotent).
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payee text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payee_override text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_desc text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS memo text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS user_note text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank jsonb'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_label text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cat_source text'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_at timestamptz'),
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_by text'),
    // Supplier invoices for STOCK. Deliberately not expense rows: a unit's cost
    // is already carried per-unit into the tracker and counted as COGS when it
    // sells, so putting the purchase in `expenses` too would double-count every
    // appliance. What was missing is the TAX on it — the single biggest input
    // credit this business has — so the invoice is recorded for that alone.
    query(`CREATE TABLE IF NOT EXISTS purchase_invoices (
      id serial PRIMARY KEY,
      vendor text,
      invoice_number text,
      invoice_date date NOT NULL,
      subtotal numeric(10,2),
      tax numeric(10,2) NOT NULL DEFAULT 0,
      total numeric(10,2),
      units int NOT NULL DEFAULT 0,
      note text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`)
  ])).then(() => Promise.all([
    // One row per supplier invoice. Re-uploading the same invoice UPDATES it
    // instead of adding a second — claiming the same credit twice is the way
    // this feature could actually cost money.
    // Vendor → category (and optionally tax treatment). What turns a bank feed
    // of raw merchant names into a P&L somebody can read.
    query(`CREATE TABLE IF NOT EXISTS expense_rules (
      id serial PRIMARY KEY,
      match_text text NOT NULL,
      category   text,
      tax_mode   text,
      hits       int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`),
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_rules_match ON expense_rules (lower(match_text))'),
    // A supplier invoice bought on terms is money OWED until it's settled —
    // that's what accounts payable is. Null here means still owing.
    query('ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS paid_at date'),
    query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_invoices_ref
             ON purchase_invoices (lower(COALESCE(vendor,'')), lower(invoice_number))
           WHERE invoice_number IS NOT NULL AND invoice_number <> ''`)
  ])).then(() => Promise.all([
    // Anything not from the bank feed was typed or categorised by a person, so
    // it counts as reviewed. Idempotent: once reviewed_at is set it matches nothing.
    query(`UPDATE expenses SET reviewed_at = COALESCE(created_at, now()),
                  cat_source = CASE WHEN COALESCE(source,'manual') = 'qbo' THEN 'qbo' ELSE 'manual' END
            WHERE COALESCE(source,'manual') <> 'plaid' AND reviewed_at IS NULL`),
    // The two category names merged into the Costs section's wording.
    query(`UPDATE expenses SET category = 'Advertising' WHERE category = 'Marketing'`),
    query(`UPDATE expenses SET category = 'Card & bank fees' WHERE category = 'Fees'`),
    query(`UPDATE expense_rules SET category = 'Advertising' WHERE category = 'Marketing'`),
    query(`UPDATE expense_rules SET category = 'Card & bank fees' WHERE category = 'Fees'`)
  ])).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// The last two are NOT expenses, and the ledger routes them accordingly: a loan
// repayment reduces a liability, an owner draw reduces equity. Both arrive in a
// bank feed looking exactly like an ordinary withdrawal, and booking either as a
// cost understates profit by the whole amount — so they need somewhere to go.
// One list for the bank feed AND the Costs section (lib/daily-cost-math.js), so a
// bill is the same thing wherever it is entered. Where the two used different
// words for the same thing, the Costs name won (Advertising, Card & bank fees);
// the migration renames what was already saved. "Interest charges" is
// deliberately NOT worded with "loan": the ledger routes any category containing
// loan/repayment to the loan liability, and interest is a cost.
export const EXPENSE_CATEGORIES = [
  'Rent / storage', 'Utilities', 'Insurance', 'Software', 'Truck (lease, plates, upkeep)',
  'Fuel / delivery', 'Wages', 'Tools / supplies', 'Advertising', 'Card & bank fees', 'Interest charges',
  'Fuel', 'Delivery (carriers we pay)', 'Advertising - Google', 'Advertising - Facebook / Instagram', 'Advertising - Other',
  'Other', 'Loan repayment', 'Owner draw', 'Owner draw - Ravi', 'Owner draw - Sai'
];
export const AD_CHANNELS = ['Meta', 'Google', 'Kijiji', 'Flyer / print', 'Other'];
export const AD_BRANDS = [
  { key: 'bargain_bay', label: 'Bargain Bay' },
  { key: 'rs_solutions', label: 'RS Solutions' }
];
const brandOrNull = (b) => (AD_BRANDS.some((x) => x.key === b) ? b : null);

const n = (v) => Number(v || 0);

// ── Expenses ────────────────────────────────────────────────────────────────
// `opts` is a row cap (number) or { from, to, limit } with inclusive ISO dates,
// so a bank month older than the newest N rows can still be reached.
export async function listExpenses(opts = 100) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const o = typeof opts === 'number' ? { limit: opts } : (opts || {});
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const where = []; const args = [];
  if (o.from && iso.test(o.from)) { args.push(o.from); where.push(`incurred_on >= $${args.length}`); }
  if (o.to && iso.test(o.to)) { args.push(o.to); where.push(`incurred_on <= $${args.length}`); }
  args.push(Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), 5000));
  const [{ rows }, splits] = await Promise.all([
    query(`SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY incurred_on DESC, id DESC LIMIT $${args.length}`, args),
    loadSplits()
  ]);
  const childOf = new Map();
  for (const [pid, s] of Object.entries(splits)) for (const c of s.children || []) childOf.set(Number(c), Number(pid));
  return rows.map((r) => ({
    id: r.id,
    incurredOn: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null,
    category: r.category, vendor: r.vendor, amount: n(r.amount),
    // null ≠ 0. Null means the HST on this row has never been looked at.
    tax: r.tax == null ? null : n(r.tax),
    note: r.note, source: r.source || 'manual',
    // 'parent' = the bank line that was split (its first part), 'child' = the
    // other parts. Drives the Split / Undo buttons and the pills.
    split: splits[r.id] ? 'parent' : (childOf.has(Number(r.id)) ? 'child' : null)
  }));
}

// `tax` is optional and tri-state: a number (HST paid), 0 (checked, none), or
// undefined/null (nobody has said). Kept out of `amount`, which stays the
// pre-tax cost the P&L is built on.
const taxOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const t = Number(v);
  return Number.isFinite(t) && t >= 0 ? Math.round(t * 100) / 100 : null;
};

export async function addExpense({ incurredOn, category, vendor, amount, note, tax }) {
  await ensureFinanceSchema();
  const { rows } = await query(
    `INSERT INTO expenses (incurred_on, category, vendor, amount, note, tax, cat_source, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'manual', now()) RETURNING id`,
    [incurredOn, category || null, vendor || null, n(amount), note || null, taxOrNull(tax)]
  );
  return rows[0].id;
}

// Correct a row that was typed wrong, or fill in the HST on one that predates
// the tax column. Only the fields actually supplied are touched.
export async function updateExpense(id, patch = {}) {
  await ensureFinanceSchema();
  const sets = [];
  const args = [Number(id)];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  if (has('incurredOn') && patch.incurredOn) put('incurred_on', patch.incurredOn);
  if (has('category')) put('category', patch.category || null);
  if (has('vendor')) put('vendor', patch.vendor || null);
  if (has('amount')) put('amount', n(patch.amount));
  if (has('note')) put('note', patch.note || null);
  if (has('tax')) put('tax', taxOrNull(patch.tax));
  // Choosing a category by hand is a decision: the bank feed must not undo it,
  // and the line leaves the review queue.
  if (has('category')) { sets.push(`cat_source = 'manual'`); sets.push('reviewed_at = COALESCE(reviewed_at, now())'); }
  if (!sets.length) return false;
  const { rowCount } = await query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $1`, args);
  return rowCount > 0;
}
// Remove a synced row by its external id — a bank transaction Plaid later
// retracted, or one it recategorized into something that was never a cost.
export async function deleteExpenseByExtId(extId) {
  if (!extId) return false;
  await ensureFinanceSchema();
  // A split bank line that the bank retracts takes its parts with it.
  const { rows } = await query('SELECT id FROM expenses WHERE ext_id = $1', [extId]);
  for (const r of rows) await removeSplitFamily(Number(r.id));
  const { rowCount } = await query('DELETE FROM expenses WHERE ext_id = $1', [extId]);
  return rowCount > 0;
}

// ── Splitting one bank line into several ────────────────────────────────────
// A single card charge is often two things (a Home Depot run that was half
// tools and half the shop's supplies, a fuel stop that also bought a part). The
// parent row stays where it is and keeps the FIRST part; the other parts are new
// rows. The money is checked in whole cents: the parts must add back to exactly
// what the bank took, or nothing is written.
//
// The record of what was split lives in one settings row rather than a column:
//   { [parentId]: { extId, orig: { amount, tax, category, note }, children: [ids] } }
// It exists for two reasons. The bank feed re-sends a transaction when it
// changes, and without it the next sync would write the full amount back over the
// first part and count the charge twice. And Undo needs what the row looked like
// before.
const SPLITS_KEY = 'expense_splits';
export async function loadSplits() {
  const v = await getSetting(SPLITS_KEY, {}).catch(() => ({}));
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
// ext_ids the bank feed must not overwrite.
export async function splitExtIds() {
  return new Set(Object.values(await loadSplits()).map((s) => s.extId).filter(Boolean));
}
async function removeSplitFamily(parentId) {
  const splits = await loadSplits();
  const s = splits[parentId];
  if (!s) return;
  if ((s.children || []).length) await query('DELETE FROM expenses WHERE id = ANY($1::int[])', [s.children]);
  delete splits[parentId];
  await setSetting(SPLITS_KEY, splits);
}

const TAX_MODES = new Set(['hst', 'none', 'review']);
const cents = (v) => Math.round((Number(v) || 0) * 100);

// parts: [{ amount (what the bank took for this part, tax included), category,
//           taxMode: 'hst' (13% inside) | 'none' | 'review' (decide later), note }]
export async function splitExpense(id, parts) {
  await ensureFinanceSchema();
  id = Number(id);
  if (!Array.isArray(parts) || parts.length < 2) throw new Error('A split needs at least two parts.');
  if (parts.length > 12) throw new Error('At most 12 parts.');
  const splits = await loadSplits();
  if (splits[id]) throw new Error('This line is already split. Undo the split first.');
  if (Object.values(splits).some((s) => (s.children || []).includes(id))) {
    throw new Error('This line is already one part of a split.');
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [id]);
    const r = rows[0];
    if (!r) throw new Error('That expense no longer exists.');
    const total = cents(n(r.amount) + (r.tax == null ? 0 : n(r.tax)));
    const calc = parts.map((p, i) => {
      const g = cents(p.amount);
      if (!(g > 0)) throw new Error(`Part ${i + 1}: enter an amount above zero.`);
      const mode = TAX_MODES.has(p.taxMode) ? p.taxMode : 'review';
      let cost = g / 100, tax = null;
      if (mode === 'hst') { const s = splitGross(g / 100); cost = s.cost; tax = s.tax; }
      else if (mode === 'none') tax = 0;
      return { g, cost, tax, category: p.category || null, note: p.note ? String(p.note).slice(0, 200) : null };
    });
    const sum = calc.reduce((a, c) => a + c.g, 0);
    if (sum !== total) {
      const f = (c) => (c / 100).toFixed(2);
      throw new Error(`The parts add up to $${f(sum)} but the bank line is $${f(total)}. They must match exactly.`);
    }

    const first = calc[0];
    await client.query(
      'UPDATE expenses SET category = $2, amount = $3, tax = $4, note = $5 WHERE id = $1',
      [id, first.category, first.cost, first.tax, [r.note, 'split 1/' + calc.length].filter(Boolean).join(' · ')]
    );
    const children = [];
    for (let i = 1; i < calc.length; i++) {
      const c = calc[i];
      const ins = await client.query(
        `INSERT INTO expenses (incurred_on, category, vendor, amount, note, source, ext_id, tax)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [r.incurred_on, c.category, r.vendor, c.cost,
         [c.note || r.note, `split ${i + 1}/${calc.length}`].filter(Boolean).join(' · '),
         r.source || 'manual', r.ext_id ? `${r.ext_id}#s${i + 1}` : null, c.tax]
      );
      children.push(ins.rows[0].id);
    }
    return {
      children,
      record: { extId: r.ext_id || null, orig: { amount: n(r.amount), tax: r.tax == null ? null : n(r.tax), category: r.category, note: r.note }, children }
    };
  });

  // The record is what protects the split from the next bank sync, so a failure
  // to write it is reported rather than swallowed: the rows exist, and without
  // the record the feed could write the full amount back over the first part.
  try {
    const next = await loadSplits();
    next[id] = result.record;
    await setSetting(SPLITS_KEY, next);
  } catch (e) {
    throw new Error('The split was saved but could not be recorded, so the bank feed may overwrite it. Undo it and try again. ' + (e?.message || ''));
  }
  return { id, children: result.children };
}

// Put the bank line back exactly as it was and drop the other parts.
export async function unsplitExpense(id) {
  await ensureFinanceSchema();
  id = Number(id);
  const splits = await loadSplits();
  const s = splits[id];
  if (!s) throw new Error('That line is not a split.');
  await withTransaction(async (client) => {
    if ((s.children || []).length) await client.query('DELETE FROM expenses WHERE id = ANY($1::int[])', [s.children]);
    await client.query(
      'UPDATE expenses SET category = $2, amount = $3, tax = $4, note = $5 WHERE id = $1',
      [id, s.orig.category || null, s.orig.amount, s.orig.tax, s.orig.note || null]
    );
  });
  delete splits[id];
  await setSetting(SPLITS_KEY, splits);
  return true;
}

// Rows nobody has told us the tax on. This is the review queue: until a row has
// a tax figure it claims no input credit, and the remittance panel counts it as
// the gap it is. Newest first — a bank feed lands in date order and the recent
// end is what somebody actually remembers.
export async function listUnreviewedExpenses(limit = 200) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query(
    `SELECT * FROM expenses WHERE tax IS NULL ORDER BY incurred_on DESC, id DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    incurredOn: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null,
    category: r.category, vendor: r.vendor, amount: n(r.amount),
    note: r.note, source: r.source || 'manual'
  }));
}

// Settle the tax on a batch of rows in one go — the only way a bank feed of
// several thousand charges ever gets reviewed.
//
//  'hst'  — the charge INCLUDED 13% HST. The gross amount off the statement is
//           split: the cost drops to the pre-tax figure and the rest becomes the
//           credit. (An imported amount is gross; that's what a bank line is.)
//  'none' — checked, and there was no recoverable tax (wages, insurance, a US
//           supplier). Recorded as 0, which is an answer, unlike NULL.
export async function bulkSetExpenseTax(ids = [], mode = 'none') {
  await ensureFinanceSchema();
  const list = [...new Set((ids || []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  if (!list.length) return { updated: 0, credit: 0 };
  if (mode === 'hst') {
    // Mirrors splitGross() in lib/tax.js — round(amount / 1.13, 2) is the
    // pre-tax cost and the remainder is the credit, so the two halves always add
    // back to the charge that actually came off the account. Keep them in step:
    // the review screen previews the claim using that helper.
    // Done in SQL so several thousand rows are one statement, not a round trip
    // per row.
    const { rows } = await query(
      `UPDATE expenses
          SET tax = round((amount - round((amount / 1.13)::numeric, 2))::numeric, 2),
              amount = round((amount / 1.13)::numeric, 2)
        WHERE id = ANY($1) AND tax IS NULL
        RETURNING tax`,
      [list]
    );
    return { updated: rows.length, credit: Math.round(rows.reduce((a, r) => a + n(r.tax), 0) * 100) / 100 };
  }
  const { rowCount } = await query(
    'UPDATE expenses SET tax = 0 WHERE id = ANY($1) AND tax IS NULL', [list]
  );
  return { updated: rowCount || 0, credit: 0 };
}

// How many rows a given feed brought in. Powers the "these came from
// QuickBooks" count on the connection panel — which matters most when the
// answer is "46 rows of a demo company's spending".
export async function countExpensesBySource(source) {
  if (!hasDb()) return 0;
  await ensureFinanceSchema();
  const { rows } = await query('SELECT COUNT(*) AS c FROM expenses WHERE source = $1', [String(source || '')]);
  return Number(rows[0]?.c) || 0;
}

export async function deleteExpense(id) {
  await ensureFinanceSchema();
  // Deleting the bank line a split came from takes its other parts with it:
  // leaving them would keep a share of a charge that no longer exists.
  await removeSplitFamily(Number(id));
  await query('DELETE FROM expenses WHERE id = $1', [id]);
  return true;
}

// Idempotent upsert for synced rows (QuickBooks). Re-running a sync updates the
// row in place (date/category/vendor/amount follow QBO edits) instead of
// duplicating it. Owner-entered rows (no ext_id) are never touched.
export async function upsertExpense({ incurredOn, category, vendor, amount, note, tax, extId, source = 'qbo',
                                      payee, bankDesc, memo, bank, accountLabel, catSource }) {
  await ensureFinanceSchema();
  if (!extId) throw new Error('upsertExpense needs an extId.');
  // Where the category came from decides whether a person has to look at it.
  // A match rule is the owner's own decision, QuickBooks arrives already
  // categorised in the books; only the bank's own guess needs a human.
  const cs = catSource || (source === 'plaid' ? 'guess' : source);
  const trusted = cs === 'rule' || cs === 'qbo';
  await query(
    `INSERT INTO expenses (incurred_on, category, vendor, amount, note, source, ext_id, tax,
                           payee, bank_desc, memo, bank, account_label, cat_source, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14, CASE WHEN $15 THEN now() END)
     ON CONFLICT (ext_id) WHERE ext_id IS NOT NULL
     DO UPDATE SET
       incurred_on = EXCLUDED.incurred_on,
       -- A person's decision is never undone by the bank re-sending the line.
       category = CASE WHEN expenses.cat_source IN ('manual','bulk') THEN expenses.category ELSE EXCLUDED.category END,
       -- What a person typed as the payee wins over what the bank calls it.
       vendor = COALESCE(expenses.payee_override, EXCLUDED.vendor),
       note = EXCLUDED.note,
       -- If the charge itself has not changed (same total, tax included) keep the
       -- split between cost and HST somebody already worked out; writing the gross
       -- back over a pre-tax amount that still carries its tax counts the HST twice.
       amount = CASE WHEN expenses.tax IS NOT NULL AND expenses.amount + expenses.tax = EXCLUDED.amount + COALESCE(EXCLUDED.tax, 0)
                     THEN expenses.amount ELSE EXCLUDED.amount END,
       tax = CASE WHEN expenses.tax IS NOT NULL AND expenses.amount + expenses.tax = EXCLUDED.amount + COALESCE(EXCLUDED.tax, 0)
                  THEN expenses.tax ELSE EXCLUDED.tax END,
       payee = EXCLUDED.payee, bank_desc = EXCLUDED.bank_desc, memo = EXCLUDED.memo,
       bank = EXCLUDED.bank, account_label = EXCLUDED.account_label,
       cat_source = CASE WHEN expenses.cat_source IN ('manual','bulk') THEN expenses.cat_source ELSE EXCLUDED.cat_source END,
       reviewed_at = CASE WHEN expenses.cat_source IN ('manual','bulk') THEN expenses.reviewed_at
                          ELSE COALESCE(expenses.reviewed_at, EXCLUDED.reviewed_at) END`,
    [incurredOn, category || null, vendor || null, Number(amount) || 0, note || null, source, extId, taxOrNull(tax),
     payee || null, bankDesc || null, memo || null, bank ? JSON.stringify(bank) : null, accountLabel || null, cs, trusted]
  );
}

// Fill in the bank's details on a line we already hold, touching nothing a person
// could have decided (category, amount, tax, vendor). Used when a bank is re-read
// once to pick up fields that were not kept the first time. Returns false when
// the line is not in the ledger (it was deleted, or predates the books).
export async function fillExpenseDetails({ extId, payee, bankDesc, memo, bank, accountLabel, catSource }) {
  await ensureFinanceSchema();
  const r = await query(
    `UPDATE expenses SET
        payee = $2, bank_desc = $3, memo = $4, bank = $5::jsonb, account_label = $6,
        cat_source = COALESCE(cat_source, $7),
        reviewed_at = COALESCE(reviewed_at, CASE WHEN COALESCE(cat_source, $7) = 'rule' THEN now() END)
      WHERE ext_id = $1`,
    [extId, payee || null, bankDesc || null, memo || null, bank ? JSON.stringify(bank) : null, accountLabel || null, catSource || 'guess']
  );
  return r.rowCount > 0;
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
  return rows.map((r) => ({ id: r.id, spentOn: r.spent_on ? new Date(r.spent_on).toISOString().slice(0, 10) : null, channel: r.channel, amount: n(r.amount), campaign: r.campaign, note: r.note, brand: r.brand || null, source: r.source || 'manual' }));
}
export async function addAdSpend({ spentOn, channel, amount, campaign, note, brand }) {
  await ensureFinanceSchema();
  const { rows } = await query(
    "INSERT INTO ad_spend (spent_on, channel, amount, campaign, note, source, brand) VALUES ($1,$2,$3,$4,$5,'manual',$6) RETURNING id",
    [spentOn, channel || 'Other', n(amount), campaign || null, note || null, brandOrNull(brand)]
  );
  return rows[0].id;
}

// Assign (or clear) the business a spend row belongs to. `scope: 'campaign'`
// applies it to every row of the same channel + campaign name, which is how
// "all of this Meta campaign is RS Solutions" is one click.
export async function setAdSpendBrand(id, brand, { scope = 'row' } = {}) {
  await ensureFinanceSchema();
  const b = brandOrNull(brand);
  if (scope === 'campaign') {
    const r = await query(
      `UPDATE ad_spend SET brand = $2
        WHERE (channel, COALESCE(campaign,'')) = (SELECT channel, COALESCE(campaign,'') FROM ad_spend WHERE id = $1)`,
      [id, b]
    );
    return r.rowCount;
  }
  const r = await query('UPDATE ad_spend SET brand = $2 WHERE id = $1', [id, b]);
  return r.rowCount;
}

// Idempotent upsert for synced rows (Meta). De-dupes on ext_id so re-running a
// sync never double-counts; owner 'manual' rows are never touched.
export async function upsertAdSpend({ spentOn, channel, amount, campaign, extId, source = 'meta', brand }) {
  await ensureFinanceSchema();
  // A brand a person assigned by hand is never overwritten by a re-sync; the
  // account's default brand only fills a blank.
  await query(
    `INSERT INTO ad_spend (spent_on, channel, amount, campaign, source, ext_id, brand)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (ext_id) WHERE ext_id IS NOT NULL
     DO UPDATE SET spent_on = EXCLUDED.spent_on, amount = EXCLUDED.amount, campaign = EXCLUDED.campaign,
                   brand = COALESCE(ad_spend.brand, EXCLUDED.brand)`,
    [spentOn, channel, n(amount), campaign || null, source, extId, brandOrNull(brand)]
  );
}
export async function deleteAdSpend(id) {
  await ensureFinanceSchema();
  await query('DELETE FROM ad_spend WHERE id = $1', [id]);
  return true;
}

// ── Purchase invoices (stock) ───────────────────────────────────────────────
// Recorded for ONE reason: the HST on them. A unit's cost already reaches the
// P&L per-unit through the tracker, so these rows are deliberately not expenses
// — see the table comment in ensureFinanceSchema.

export async function listPurchaseInvoices(limit = 100) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query(
    'SELECT * FROM purchase_invoices ORDER BY invoice_date DESC, id DESC LIMIT $1', [limit]
  );
  return rows.map((r) => ({
    id: r.id, vendor: r.vendor, invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date ? new Date(r.invoice_date).toISOString().slice(0, 10) : null,
    subtotal: n(r.subtotal), tax: n(r.tax), total: n(r.total),
    units: Number(r.units) || 0, note: r.note,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : null
  }));
}

// Write (or correct) one supplier invoice. Keyed on vendor + invoice number, so
// re-uploading the same PDF updates the row rather than claiming its credit a
// second time. An invoice with no number can't be de-duped, so it is always a
// new row — better a visible duplicate than a silently merged pair.
export async function recordPurchaseInvoice({
  vendor, invoiceNumber, invoiceDate, subtotal, tax, total, units, note, createdBy
} = {}) {
  await ensureFinanceSchema();
  const date = String(invoiceDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The invoice needs a date (YYYY-MM-DD) before its HST can be claimed.');
  const ref = String(invoiceNumber || '').trim() || null;
  const args = [
    String(vendor || '').trim() || null, ref, date,
    n(subtotal), Math.max(0, n(tax)), n(total),
    Math.max(0, parseInt(units, 10) || 0),
    String(note || '').trim() || null,
    String(createdBy || '').trim().toLowerCase() || null
  ];
  if (ref) {
    const { rows } = await query(
      `INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total, units, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (lower(COALESCE(vendor,'')), lower(invoice_number))
         WHERE invoice_number IS NOT NULL AND invoice_number <> ''
       DO UPDATE SET invoice_date = EXCLUDED.invoice_date, subtotal = EXCLUDED.subtotal,
                     tax = EXCLUDED.tax, total = EXCLUDED.total, units = EXCLUDED.units,
                     note = EXCLUDED.note
       RETURNING id, (xmax <> 0) AS updated`,
      args
    );
    return { id: rows[0].id, updated: !!rows[0].updated };
  }
  const { rows } = await query(
    `INSERT INTO purchase_invoices (vendor, invoice_number, invoice_date, subtotal, tax, total, units, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    args
  );
  return { id: rows[0].id, updated: false };
}

export async function deletePurchaseInvoice(id) {
  await ensureFinanceSchema();
  await query('DELETE FROM purchase_invoices WHERE id = $1', [Number(id)]);
  return true;
}

// ── Where the books begin ───────────────────────────────────────────────────
// A hard floor on the automatic feeds. Everything before it belongs to whatever
// the shop was running on previously; importing it would produce a P&L stitched
// from two systems. Manual entry and uploaded purchase invoices are NOT capped —
// those are deliberate acts by a person who knows what they're recording.
export async function getLedgerStart() {
  const v = await getSetting('ledger_start', null);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : LEDGER_START_DEFAULT;
}

export async function setLedgerStart(date) {
  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Use a date like 2026-08-01.');
  await setSetting('ledger_start', d);
  return d;
}

// ── Categorisation rules ────────────────────────────────────────────────────
// A bank feed and an uncategorised QuickBooks both produce the same thing: a
// vendor name and an amount. These turn that into a category — and, where the
// owner has said so explicitly, a tax treatment.
//
// The tax half is deliberate and deliberately opt-in. A rule saying "Esso is
// fuel and carries 13%" is the owner's judgement about a supplier they know, not
// the system guessing; a rule with no tax set leaves `tax` NULL and the row goes
// to the review queue as before. That distinction is the whole reason the
// remittance figure can be trusted.
export const RULE_TAX_MODES = { hst: 'HST included at 13%', none: 'No recoverable tax' };

export async function listExpenseRules() {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query('SELECT * FROM expense_rules ORDER BY lower(match_text)');
  return rows.map((r) => ({
    id: r.id, match: r.match_text, category: r.category,
    taxMode: r.tax_mode || null, hits: Number(r.hits) || 0,
    createdAt: r.created_at ? r.created_at.toISOString() : null
  }));
}

export async function saveExpenseRule({ id, match, category, taxMode } = {}) {
  await ensureFinanceSchema();
  const m = String(match || '').trim().toLowerCase();
  if (m.length < 2) throw new Error('A rule needs at least two characters to match on.');
  const cat = String(category || '').trim() || null;
  const tax = RULE_TAX_MODES[taxMode] ? taxMode : null;
  if (!cat && !tax) throw new Error('A rule has to set a category, a tax treatment, or both.');
  const n = parseInt(id, 10);
  if (Number.isFinite(n)) {
    await query('UPDATE expense_rules SET match_text=$2, category=$3, tax_mode=$4 WHERE id=$1', [n, m, cat, tax]);
    return n;
  }
  const { rows } = await query(
    `INSERT INTO expense_rules (match_text, category, tax_mode) VALUES ($1,$2,$3)
     ON CONFLICT (lower(match_text)) DO UPDATE SET category = EXCLUDED.category, tax_mode = EXCLUDED.tax_mode
     RETURNING id`,
    [m, cat, tax]
  );
  return rows[0].id;
}

export async function deleteExpenseRule(id) {
  await ensureFinanceSchema();
  await query('DELETE FROM expense_rules WHERE id = $1', [Number(id)]);
  return true;
}

// The rules, once, for a whole import run — matching per row would mean a query
// per transaction, and a first bank pull is thousands of them.
export async function loadRules() {
  if (!hasDb()) return [];
  try {
    await ensureFinanceSchema();
    const { rows } = await query('SELECT id, match_text, category, tax_mode FROM expense_rules');
    // Longest match first: "canadian tire gas" should beat "canadian tire".
    return rows
      .map((r) => ({ id: r.id, match: String(r.match_text || '').toLowerCase(), category: r.category, taxMode: r.tax_mode || null }))
      .filter((r) => r.match.length >= 2)
      .sort((a, b) => b.match.length - a.match.length);
  } catch {
    return [];
  }
}

// First rule whose text appears in the vendor (or the note, for feeds that put
// the merchant there). Substring, not regex: these are typed by a shop owner
// between deliveries, and "esso" should just work.
export function matchRule(rules, vendor, note = '') {
  const hay = `${vendor || ''} ${note || ''}`.toLowerCase();
  if (!hay.trim()) return null;
  return rules.find((r) => hay.includes(r.match)) || null;
}

// Apply the rules to rows already in the ledger. For after a rule is added —
// otherwise it only ever helps transactions that haven't arrived yet, and the
// pile that prompted the rule sits there uncategorised.
//
// Only fills BLANKS: a category the owner set by hand, or a tax figure already
// answered, is never overwritten by a rule written later.
export async function applyRulesToExisting({ onlyUncategorised = true } = {}) {
  if (!hasDb()) return { categorised: 0, taxed: 0 };
  await ensureFinanceSchema();
  const rules = await loadRules();
  if (!rules.length) return { categorised: 0, taxed: 0 };

  const { rows } = await query(
    `SELECT id, vendor, note, category, tax, cat_source FROM expenses
      WHERE ${onlyUncategorised ? "(category IS NULL OR category = '' OR category = 'Other' OR tax IS NULL)" : 'true'}`
  );
  let categorised = 0, taxed = 0;
  for (const r of rows) {
    const hit = matchRule(rules, r.vendor, r.note);
    if (!hit) continue;
    const sets = [];
    const args = [r.id];
    const generic = !r.category || r.category === 'Other';
    // A category a person chose (even "Other") is a decision, not a blank.
    if (hit.category && generic && !['manual', 'bulk'].includes(r.cat_source)) {
      args.push(hit.category); sets.push(`category = $${args.length}`);
      // The owner's own rule decided it, so it leaves the review queue.
      sets.push(`cat_source = 'rule'`, 'reviewed_at = COALESCE(reviewed_at, now())');
      categorised++;
    }
    if (hit.taxMode && r.tax == null) {
      // Same split the review screen uses: the stored amount is gross.
      if (hit.taxMode === 'hst') {
        sets.push(`tax = round((amount - round((amount / 1.13)::numeric, 2))::numeric, 2)`);
        sets.push(`amount = round((amount / 1.13)::numeric, 2)`);
      } else {
        sets.push('tax = 0');
      }
      taxed++;
    }
    if (!sets.length) continue;
    await query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $1`, args);
    await query('UPDATE expense_rules SET hits = hits + 1 WHERE id = $1', [hit.id]).catch(() => {});
  }
  return { categorised, taxed };
}

// ── Suggesting rules from what actually arrived ─────────────────────────────
// The difference between "another tool with a review queue" and less work.
//
// Nobody categorises two thousand transactions one at a time. But those two
// thousand are rarely two thousand different things — they are thirty patterns
// repeated. This finds the patterns and offers each one as a single decision.
//
// It has to work on BANK DESCRIPTORS, not merchant names. A TD e-transfer reads
// `SEND E-TFR *z27 SUPP`: no payee, a reference code that never repeats, and a
// three-letter suffix the owner types themselves. The signal is the suffix. So
// this tokenises the descriptor, throws away the parts that never repeat, and
// ranks what's left by how much money flows through it.

// Words that appear in every bank line and mean nothing on their own. A rule on
// "send" or "transfer" would match half the account.
const DESCRIPTOR_NOISE = new Set([
  'send', 'sent', 'tfr', 'etfr', 'transfer', 'transfers', 'etransfer', 'payment', 'payments',
  'pay', 'purchase', 'debit', 'credit', 'card', 'visa', 'mastercard', 'pos', 'pre', 'auth',
  'from', 'to', 'the', 'and', 'inc', 'ltd', 'llc', 'corp', 'co', 'bank', 'canada', 'canadian',
  'view', 'more', 'ref', 'txn', 'trans', 'withdrawal', 'deposit', 'bill', 'online', 'mobile',
  'www', 'com', 'ca', 'http', 'https',
  // The bank and the account a line came out of are on every row, so they say nothing about it.
  'td', 'trust', 'business', 'unlimited', 'account', 'chequing', 'checking', 'savings', 'investor', 'plan'
]);

// A descriptor → the tokens worth building a rule on. Reference codes are the
// enemy: `*z27`, `***h6K`, `#4432`. They are unique per transaction, so they'd
// each look like a brand-new pattern. Anything with a digit in it goes.
export function descriptorTokens(text) {
  const clean = String(text || '')
    .toLowerCase()
    // Reference codes are marked with a star on a TD line — *z27, ***h6K, *pAz.
    // They are unique per transaction, so each would look like a fresh pattern.
    // Dropping them by their marker catches the ones with no digit in them,
    // which the digit filter below can't see.
    .replace(/\*+\w*/g, ' ')
    // An apostrophe joins a word, it doesn't separate one: "Horton's" is one
    // token, not "horton" plus a stray "s".
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!clean) return [];
  const words = clean.split(' ').filter((w) =>
    w.length >= 3 && !/\d/.test(w) && !DESCRIPTOR_NOISE.has(w));
  // Adjacent pairs too: "esso circle" is a better rule than "esso" when the
  // account also has a Circle K that isn't an Esso. Longest match wins at
  // apply time, so offering both and letting the owner pick is safe.
  const pairs = [];
  for (let i = 0; i < words.length - 1; i++) pairs.push(`${words[i]} ${words[i + 1]}`);
  return [...new Set([...words, ...pairs])];
}

// Group what's in the ledger by those tokens and rank by money moved.
//
// `minCount` exists to keep one-off noise out: a token that appears twice isn't
// a pattern, it's a coincidence. Ranking by TOTAL rather than count is
// deliberate — ten $2,000 supplier transfers matter more than forty $4 coffees,
// and the owner's time should go to the former first.
export async function suggestExpenseRules({ limit = 25, minCount = 3 } = {}) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const existing = await loadRules();

  const { rows } = await query(
    `SELECT id, vendor, note, bank_desc, amount, category, tax FROM expenses
      WHERE category IS NULL OR category = '' OR category = 'Other' OR tax IS NULL
      ORDER BY incurred_on DESC LIMIT 4000`
  );
  if (!rows.length) return [];

  const groups = new Map();
  for (const r of rows) {
    const text = `${r.vendor || ''} ${r.note || ''}`;
    // Already covered by a rule the owner wrote — don't suggest it again.
    if (matchRule(existing, r.vendor, r.note)) continue;
    // Look at what the line SAYS (who it is, what the bank wrote), never the note: a bank line's
    // note is "TD Canada Trust · <account owner>", the same on every row, which used to make
    // "trust" a "pattern" joining a hot-pot lunch to the bank's own statement fee.
    const said = `${r.vendor || ''} ${r.bank_desc || ''}`;
    for (const token of descriptorTokens(said)) {
      const g = groups.get(token) || { token, count: 0, total: 0, samples: [], needsCategory: 0, needsTax: 0 };
      g.count += 1;
      g.total = Math.round((g.total + n(r.amount)) * 100) / 100;
      if (!r.category || r.category === 'Other') g.needsCategory += 1;
      if (r.tax == null) g.needsTax += 1;
      if (g.samples.length < 3 && !g.samples.includes(said.trim())) g.samples.push(said.trim().slice(0, 90));
      groups.set(token, g);
    }
  }

  const ranked = [...groups.values()]
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.total - a.total || b.count - a.count);

  // Drop a token whose transactions are already covered by a longer phrase we're
  // also suggesting — offering both "esso" and "esso circle" for the same forty
  // rows is two decisions where one will do. The longer one is kept: it is the
  // more precise rule, and it wins at apply time anyway.
  const kept = [];
  for (const g of ranked) {
    const coveredByLonger = kept.some((k) => k.token.includes(g.token) && k.count >= g.count * 0.9);
    if (!coveredByLonger) kept.push(g);
    if (kept.length >= limit) break;
  }
  return kept;
}

// Mark a supplier invoice paid (or put it back to owing). Until it's paid it
// sits in accounts payable — which for this shop is most of them.
export async function setPurchaseInvoicePaid(id, paidAt) {
  await ensureFinanceSchema();
  const d = String(paidAt || '').trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Use a date like 2026-09-15, or clear it to mark unpaid.');
  await query('UPDATE purchase_invoices SET paid_at = $2 WHERE id = $1', [Number(id), d || null]);
  return d || null;
}

// What's still owed to suppliers, oldest first — the accounts-payable list.
export async function unpaidPurchaseInvoices() {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  try {
    const { rows } = await query(
      `SELECT id, vendor, invoice_number, invoice_date, subtotal, tax, total
         FROM purchase_invoices WHERE paid_at IS NULL ORDER BY invoice_date, id`
    );
    return rows.map((r) => ({
      id: r.id, vendor: r.vendor, invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date ? new Date(r.invoice_date).toISOString().slice(0, 10) : null,
      subtotal: n(r.subtotal), tax: n(r.tax), total: n(r.total)
    }));
  } catch { return []; }
}

// Everything the business owns as stock, at cost — for the opening balance.
// Deliberately broader than the storefront's "inventory capital", which counts
// only ACTIVE sellable units: a balance sheet wants everything owned, including
// salvage on hand and anything bought but not yet listed.
export async function inventoryAtCost() {
  if (!hasDb()) return { sellable: 0, salvage: 0, unlisted: 0, consigned: 0, total: 0, sellableUnits: 0, salvageUnits: 0, unlistedUnits: 0, consignedUnits: 0 };
  const one = async (sql) => { try { return (await query(sql)).rows[0] || {}; } catch { return {}; } };
  // CONSIGNED stock is held, not owned — a vendor left it here and is paid only
  // when it sells (lib/consignment.js). Counting it as an asset overstates what
  // the business owns, and since nothing is owed for it yet there is no matching
  // liability, so it would overstate equity by the same amount. Excluded from
  // every owned figure and reported on its own so the exclusion is never silent.
  //
  // NOT EXISTS rather than a join: a database where nothing has ever been
  // consigned has no such table, and this is a balance-sheet number that must
  // still come out right. `one()` already soft-fails, which would silently
  // return ZERO stock — so the guard is a separate query, and if it can't be
  // read at all we fall back to counting everything as owned (the old answer)
  // rather than reporting no inventory.
  let cons = { c: 0, v: 0 };
  let consKnown = true;
  try {
    cons = (await query(
      `SELECT COUNT(*)::int AS c, COALESCE(SUM(p.cost),0) AS v
         FROM consignment_units cu JOIN products p ON p.sku = cu.sku
        WHERE p.sold_at IS NULL`
    )).rows[0] || { c: 0, v: 0 };
  } catch { consKnown = false; }
  const NOT_CONS = consKnown
    ? 'AND NOT EXISTS (SELECT 1 FROM consignment_units cu WHERE cu.sku = products.sku)'
    : '';
  const live = await one(`SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM products WHERE active = true AND sold_at IS NULL ${NOT_CONS}`);
  // Bought and owned, but not on the storefront — untested, being repaired, held
  // back. Sold units are excluded: their cost has already left via COGS.
  const held = await one(`SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM products WHERE active = false AND sold_at IS NULL ${NOT_CONS}`);
  const salv = await one("SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM salvage_units WHERE status <> 'disposed'");
  const r = {
    sellable: round2(n(live.v)), sellableUnits: Number(live.c) || 0,
    unlisted: round2(n(held.v)), unlistedUnits: Number(held.c) || 0,
    salvage: round2(n(salv.v)), salvageUnits: Number(salv.c) || 0,
    consigned: round2(n(cons.v)), consignedUnits: Number(cons.c) || 0
  };
  // `total` is what we OWN. Consigned stock is deliberately outside it.
  return { ...r, total: round2(r.sellable + r.unlisted + r.salvage) };
}


// ── Categorising at scale ───────────────────────────────────────────────────
// The workspace behind /admin/categorize. The shape of the problem: a bank feed
// is thousands of lines and a person can look at a few dozen payees. So the unit of
// work is the PAYEE (every Home Depot line at once) and the queue is "has a
// person looked at this yet" (reviewed_at), not "is it blank" — the bank's own
// guess fills the category on arrival, which makes a blank test useless.
const SORTS = {
  date: 'incurred_on DESC, id DESC',
  oldest: 'incurred_on ASC, id ASC',
  amount: '(amount + COALESCE(tax,0)) DESC, id DESC',
  payee: `lower(COALESCE(payee_override, payee, vendor, '')) ASC, incurred_on DESC, id DESC`
};

function categorizeWhere(f = {}) {
  const c = ['true'], a = [];
  const p = (v) => { a.push(v); return `$${a.length}`; };
  if (f.status === 'review' || !f.status) c.push('reviewed_at IS NULL');
  else if (f.status === 'reviewed') c.push('reviewed_at IS NOT NULL');
  else if (f.status === 'rules') c.push(`cat_source = 'rule'`);
  if (Array.isArray(f.ids) && f.ids.length) {
    const ids = f.ids.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 500);
    c.push(`id = ANY(${p(ids)}::int[])`);
  }
  const q = String(f.q || '').trim();
  if (q) {
    const like = p(`%${q.toLowerCase()}%`);
    c.push(`(lower(concat_ws(' ', vendor, payee, payee_override, bank_desc, memo, user_note, note, category, account_label)) LIKE ${like}
             OR (amount + COALESCE(tax,0))::text LIKE ${like})`);
  }
  if (f.from) c.push(`incurred_on >= ${p(f.from)}`);
  if (f.to) c.push(`incurred_on <= ${p(f.to)}`);
  if (f.account) c.push(`account_label = ${p(f.account)}`);
  if (f.category === '__none') c.push(`(category IS NULL OR category = '')`);
  else if (f.category) c.push(`category = ${p(f.category)}`);
  if (f.min !== undefined && f.min !== '' && Number.isFinite(Number(f.min))) c.push(`(amount + COALESCE(tax,0)) >= ${p(Number(f.min))}`);
  if (f.max !== undefined && f.max !== '' && Number.isFinite(Number(f.max))) c.push(`(amount + COALESCE(tax,0)) <= ${p(Number(f.max))}`);
  return { where: c.join(' AND '), args: a };
}

function categorizeRow(r) {
  const base = {
    id: r.id,
    date: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null,
    vendor: r.vendor || '', payee: r.payee || '', payeeOverride: r.payee_override || '',
    bankDesc: r.bank_desc || '', memo: r.memo || '', userNote: r.user_note || '',
    accountLabel: r.account_label || '', category: r.category || '',
    amount: n(r.amount), tax: r.tax == null ? null : n(r.tax),
    catSource: r.cat_source || null, reviewed: !!r.reviewed_at,
    source: r.source || 'manual', bank: r.bank || null
  };
  base.gross = Math.round((base.amount + (base.tax || 0)) * 100) / 100;
  base.label = payeeLabel(base);
  base.key = payeeKey(base);
  return base;
}

// What this ledger already decided for each payee: the commonest category among
// lines a person (or one of their rules) settled. Offered as a one-click
// suggestion on lines still waiting.
async function suggestionMap() {
  const { rows } = await query(
    `SELECT vendor, payee, payee_override, bank_desc, category FROM expenses
      WHERE cat_source IN ('manual','bulk','rule') AND category IS NOT NULL AND category <> ''
      ORDER BY id DESC LIMIT 20000`
  );
  const by = new Map();
  for (const r of rows) {
    const k = payeeKey({ payeeOverride: r.payee_override, payee: r.payee, vendor: r.vendor, bankDesc: r.bank_desc });
    if (k === 'unknown') continue;
    const m = by.get(k) || new Map();
    m.set(r.category, (m.get(r.category) || 0) + 1);
    by.set(k, m);
  }
  const out = new Map();
  for (const [k, m] of by) {
    const [cat, count] = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
    out.set(k, { category: cat, count });
  }
  return out;
}

export async function categorizeStats() {
  if (!hasDb()) return { toReview: 0, reviewed: 0, total: 0, toReviewGross: 0 };
  await ensureFinanceSchema();
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE reviewed_at IS NULL) AS to_review,
            count(*) FILTER (WHERE reviewed_at IS NOT NULL) AS reviewed,
            count(*) AS total,
            COALESCE(sum(amount + COALESCE(tax,0)) FILTER (WHERE reviewed_at IS NULL), 0) AS to_review_gross
       FROM expenses`
  );
  const r = rows[0] || {};
  return { toReview: Number(r.to_review) || 0, reviewed: Number(r.reviewed) || 0, total: Number(r.total) || 0, toReviewGross: round2(n(r.to_review_gross)) };
}

export async function categorizeAccounts() {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query(`SELECT DISTINCT account_label FROM expenses WHERE account_label IS NOT NULL ORDER BY 1`);
  return rows.map((r) => r.account_label);
}

export async function listForCategorize(f = {}) {
  if (!hasDb()) return { rows: [], total: 0, gross: 0 };
  await ensureFinanceSchema();
  const { where, args } = categorizeWhere(f);
  const limit = Math.min(Math.max(parseInt(f.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(f.offset, 10) || 0, 0);
  const order = SORTS[f.sort] || SORTS.date;
  const [{ rows }, tot, sugg] = await Promise.all([
    query(`SELECT * FROM expenses WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT count(*) AS c, COALESCE(sum(amount + COALESCE(tax,0)),0) AS g FROM expenses WHERE ${where}`, args),
    suggestionMap().catch(() => new Map())
  ]);
  return {
    rows: rows.map((r) => {
      const o = categorizeRow(r);
      const sg = !o.reviewed ? sugg.get(o.key) : null;
      if (sg) { o.suggest = sg.category; o.suggestN = sg.count; }
      return o;
    }),
    total: Number(tot.rows[0].c) || 0,
    gross: round2(n(tot.rows[0].g))
  };
}

// The same lines, folded into payees. At most 5,000 lines are read — the queue a
// person can meaningfully work through — and the screen says when it is capped.
export async function payeeGroups(f = {}) {
  if (!hasDb()) return { groups: [], capped: false, lines: 0 };
  await ensureFinanceSchema();
  const { where, args } = categorizeWhere(f);
  const CAP = 5000;
  const [{ rows }, sugg] = await Promise.all([
    query(`SELECT * FROM expenses WHERE ${where} ORDER BY incurred_on DESC, id DESC LIMIT ${CAP + 1}`, args),
    suggestionMap().catch(() => new Map())
  ]);
  const capped = rows.length > CAP;
  const map = new Map();
  for (const r of rows.slice(0, CAP)) {
    const o = categorizeRow(r);
    const g = map.get(o.key) || { key: o.key, label: o.label, count: 0, named: 0, total: 0, from: o.date, to: o.date, ids: [], descs: new Set(), cats: new Map(), accounts: new Set() };
    g.count++; g.total += o.gross; g.ids.push(o.id);
    if (o.payee || o.payeeOverride) g.named++; // does the bank (or a person) say who this is?
    if (o.date < g.from) g.from = o.date; if (o.date > g.to) g.to = o.date;
    if (o.bankDesc || o.vendor) g.descs.add(o.bankDesc || o.vendor);
    if (o.memo) g.descs.add(o.memo);
    g.cats.set(o.category || '', (g.cats.get(o.category || '') || 0) + 1);
    if (o.accountLabel) g.accounts.add(o.accountLabel);
    map.set(o.key, g);
  }
  const groups = [...map.values()].map((g) => {
    const sg = sugg.get(g.key);
    return {
      key: g.key, label: g.label, count: g.count, named: g.named, total: round2(g.total), from: g.from, to: g.to, ids: g.ids,
      samples: [...g.descs].slice(0, 4), accounts: [...g.accounts],
      current: [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0][0] || '',
      suggest: sg ? sg.category : null, suggestN: sg ? sg.count : 0,
      canRule: !!rulePrefix(g.label)
    };
  }).sort((a, b) => b.total - a.total);
  return { groups, capped, lines: Math.min(rows.length, CAP) };
}

// Categorise and settle HST on any number of lines in one statement.
//   taxMode: 'hst' (13% is inside the charge) | 'none' | 'review' (unknown) | undefined (leave the tax alone)
// The SQL mirrors splitGross: pre-tax = round(gross / 1.13, 2), tax = the rest.
export async function bulkCategorize({ ids, category, taxMode, makeRule = false, by = '' } = {}) {
  await ensureFinanceSchema();
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!list.length) throw new Error('Pick at least one transaction.');
  if (list.length > 5000) throw new Error('At most 5,000 at a time.');
  const cat = String(category || '').trim();
  if (!cat) throw new Error('Choose a category.');
  if (cat.length > 60) throw new Error('That category name is too long.');
  const mode = ['hst', 'none', 'review'].includes(taxMode) ? taxMode : null;
  // What each line looked like, so the last bulk action can be undone.
  const prior = await query(
    `SELECT id, category, amount, tax, cat_source, (reviewed_at IS NOT NULL) AS reviewed FROM expenses WHERE id = ANY($1::int[])`, [list]
  );
  const { rowCount, rows } = await query(
    `UPDATE expenses SET
        category = $2, cat_source = 'bulk', reviewed_at = now(), reviewed_by = $3,
        amount = CASE $4::text
                   WHEN 'hst' THEN ROUND((amount + COALESCE(tax,0)) / 1.13, 2)
                   WHEN 'none' THEN amount + COALESCE(tax,0)
                   WHEN 'review' THEN amount + COALESCE(tax,0)
                   ELSE amount END,
        tax = CASE $4::text
                WHEN 'hst' THEN (amount + COALESCE(tax,0)) - ROUND((amount + COALESCE(tax,0)) / 1.13, 2)
                WHEN 'none' THEN 0
                WHEN 'review' THEN NULL
                ELSE tax END
      WHERE id = ANY($1::int[])
      RETURNING vendor, payee, payee_override`,
    [list, cat, String(by || '').slice(0, 120) || null, mode]
  );
  // "Remember this": one rule per payee, using text that is literally in the bank's
  // descriptor. A payee with nothing distinctive in it ("send e-tfr") makes none.
  const rules = [];
  if (makeRule) {
    const seen = new Set();
    for (const r of rows) {
      const m = rulePrefix(r.payee_override || r.payee || r.vendor);
      if (!m || seen.has(m)) continue;
      seen.add(m);
      try {
        await saveExpenseRule({ match: m, category: cat, taxMode: mode === 'hst' || mode === 'none' ? mode : null });
        rules.push(m);
      } catch { /* a rule that cannot be saved must not undo the categorising */ }
    }
  }
  return {
    updated: rowCount, rules,
    before: prior.rows.map((r) => ({ id: r.id, category: r.category || '', amount: n(r.amount), tax: r.tax == null ? null : n(r.tax), catSource: r.cat_source || null, reviewed: !!r.reviewed }))
  };
}

// Undo a bulk categorise: put each line back as it was. Rules the action saved are
// NOT removed (they are listed on the Financial page's Sorting rules).
export async function restoreCategorized(rows) {
  await ensureFinanceSchema();
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Number.isInteger(Number(r.id)) && Number(r.id) > 0).slice(0, 5000);
  if (!list.length) throw new Error('Nothing to undo.');
  const r = await query(
    `UPDATE expenses e SET category = NULLIF(v.category,''), amount = v.amount, tax = v.tax, cat_source = v.cat_source,
            reviewed_at = CASE WHEN v.reviewed THEN COALESCE(e.reviewed_at, now()) ELSE NULL END, reviewed_by = NULL
       FROM unnest($1::int[], $2::text[], $3::numeric[], $4::numeric[], $5::text[], $6::bool[]) AS v(id, category, amount, tax, cat_source, reviewed)
      WHERE e.id = v.id`,
    [list.map((x) => Number(x.id)), list.map((x) => String(x.category || '')), list.map((x) => Number(x.amount) || 0),
     list.map((x) => (x.tax == null ? null : Number(x.tax))), list.map((x) => x.catSource || null), list.map((x) => !!x.reviewed)]
  );
  return { updated: r.rowCount };
}

// Every id that matches the filters (up to 5,000), for "select all N".
export async function idsForCategorize(f = {}) {
  if (!hasDb()) return { ids: [], capped: false };
  await ensureFinanceSchema();
  const { where, args } = categorizeWhere(f);
  const { rows } = await query(`SELECT id FROM expenses WHERE ${where} ORDER BY incurred_on DESC, id DESC LIMIT 5001`, args);
  return { ids: rows.slice(0, 5000).map((r) => r.id), capped: rows.length > 5000 };
}

// Who it was sent to, and a note. A name typed here wins over the bank's and is
// never overwritten by the feed. `payee: ''` clears it.
export async function annotateExpenses({ ids, payee, userNote } = {}) {
  await ensureFinanceSchema();
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 5000);
  if (!list.length) throw new Error('Pick at least one transaction.');
  let changed = 0;
  if (payee !== undefined) {
    const p = String(payee).trim().slice(0, 120);
    const r = await query(
      `UPDATE expenses SET payee_override = $2,
              vendor = CASE WHEN $2::text IS NULL THEN COALESCE(payee, bank_desc, vendor) ELSE $2 END
        WHERE id = ANY($1::int[])`,
      [list, p || null]
    );
    changed = r.rowCount;
  }
  if (userNote !== undefined) {
    const r = await query('UPDATE expenses SET user_note = $2 WHERE id = ANY($1::int[])', [list, String(userNote).trim().slice(0, 500) || null]);
    changed = Math.max(changed, r.rowCount);
  }
  return { updated: changed };
}

// Put lines back in the queue — for a mistake, or a second look.
export async function markNeedsReview(ids) {
  await ensureFinanceSchema();
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 5000);
  if (!list.length) throw new Error('Pick at least one transaction.');
  const r = await query(`UPDATE expenses SET reviewed_at = NULL, reviewed_by = NULL WHERE id = ANY($1::int[])`, [list]);
  return { updated: r.rowCount };
}

// Categories the office added itself (an expense type the built-in list does not have). Kept in settings, offered next to
// the built-ins everywhere a category is picked. The ledger routes a category by its WORDS (loan / owner / wage ...), so a
// name containing one of those is refused: it would be booked somewhere the person did not intend. Use the built-in one.
export async function getCustomCategories() {
  const v = await getSetting('custom_expense_categories', []);
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}
export async function addCustomCategory(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) throw new Error('A category name needs 2 to 40 characters.');
  if (/loan|repayment|owner|draw|wage|payroll|subcontract/i.test(n)) {
    throw new Error('That name contains a word the books treat specially (loan, owner, draw, wage, payroll). Use the built-in category for that instead.');
  }
  const have = [...EXPENSE_CATEGORIES, ...(await getCustomCategories())];
  const dup = have.find((c) => c.toLowerCase() === n.toLowerCase());
  if (dup) return dup;
  await setSetting('custom_expense_categories', [...(await getCustomCategories()), n]);
  return n;
}

// Fuel per truck: one category for each active vehicle on the dispatch list ("Fuel - Green F150"). They come from the vans
// themselves, so a truck added in Dispatch shows up here with no second list to keep in step.
export async function getVehicleFuelCategories() {
  try {
    const { rows } = await query(`SELECT name FROM vehicles WHERE active = true ORDER BY name`);
    return rows.map((r) => String(r.name || '').trim()).filter(Boolean).map((n) => `Fuel - ${n}`.slice(0, 60));
  } catch { return []; }
}
// Everything beyond the built-in list that a category dropdown should offer.
export async function getExtraCategories() {
  const [custom, trucks] = await Promise.all([getCustomCategories().catch(() => []), getVehicleFuelCategories()]);
  return [...new Set([...trucks, ...custom])];
}
