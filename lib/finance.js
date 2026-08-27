// Operating expenses + ad spend capture (self-provisioning tables). Powers the
// Financial (net profit / cash) and Marketing (ROAS / cost-per-lead) dashboards.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { LEDGER_START_DEFAULT, round2 } from './constants';

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
    query('CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ext ON expenses(ext_id) WHERE ext_id IS NOT NULL'),
    // HST PAID — the input tax credit side of a remittance. `amount` stays the
    // pre-tax cost (that's what the P&L wants); `tax` is the recoverable half,
    // and NULL means "nobody has said yet", which is different from zero. The
    // remittance panel reports how much of the ledger is still null rather than
    // quietly treating unreviewed spending as tax-free.
    query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax numeric(10,2)'),
    query('ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS tax numeric(10,2)'),
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
  ])).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// The last two are NOT expenses, and the ledger routes them accordingly: a loan
// repayment reduces a liability, an owner draw reduces equity. Both arrive in a
// bank feed looking exactly like an ordinary withdrawal, and booking either as a
// cost understates profit by the whole amount — so they need somewhere to go.
export const EXPENSE_CATEGORIES = ['Rent / storage', 'Fuel / delivery', 'Wages', 'Tools / supplies', 'Fees', 'Marketing', 'Other', 'Loan repayment', 'Owner draw'];
export const AD_CHANNELS = ['Meta', 'Google', 'Kijiji', 'Flyer / print', 'Other'];

const n = (v) => Number(v || 0);

// ── Expenses ────────────────────────────────────────────────────────────────
export async function listExpenses(limit = 100) {
  if (!hasDb()) return [];
  await ensureFinanceSchema();
  const { rows } = await query('SELECT * FROM expenses ORDER BY incurred_on DESC, id DESC LIMIT $1', [limit]);
  return rows.map((r) => ({
    id: r.id,
    incurredOn: r.incurred_on ? new Date(r.incurred_on).toISOString().slice(0, 10) : null,
    category: r.category, vendor: r.vendor, amount: n(r.amount),
    // null ≠ 0. Null means the HST on this row has never been looked at.
    tax: r.tax == null ? null : n(r.tax),
    note: r.note, source: r.source || 'manual'
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
    'INSERT INTO expenses (incurred_on, category, vendor, amount, note, tax) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
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
  if (!sets.length) return false;
  const { rowCount } = await query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $1`, args);
  return rowCount > 0;
}
// Remove a synced row by its external id — a bank transaction Plaid later
// retracted, or one it recategorized into something that was never a cost.
export async function deleteExpenseByExtId(extId) {
  if (!extId) return false;
  await ensureFinanceSchema();
  const { rowCount } = await query('DELETE FROM expenses WHERE ext_id = $1', [extId]);
  return rowCount > 0;
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
  await query('DELETE FROM expenses WHERE id = $1', [id]);
  return true;
}

// Idempotent upsert for synced rows (QuickBooks). Re-running a sync updates the
// row in place (date/category/vendor/amount follow QBO edits) instead of
// duplicating it. Owner-entered rows (no ext_id) are never touched.
export async function upsertExpense({ incurredOn, category, vendor, amount, note, tax, extId, source = 'qbo' }) {
  await ensureFinanceSchema();
  if (!extId) throw new Error('upsertExpense needs an extId.');
  await query(
    `INSERT INTO expenses (incurred_on, category, vendor, amount, note, source, ext_id, tax)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (ext_id) WHERE ext_id IS NOT NULL
     DO UPDATE SET incurred_on = EXCLUDED.incurred_on, category = EXCLUDED.category,
                   vendor = EXCLUDED.vendor, amount = EXCLUDED.amount, note = EXCLUDED.note,
                   -- Never blank a tax figure a person has since corrected by
                   -- hand just because the next sync couldn't read one.
                   tax = COALESCE(EXCLUDED.tax, expenses.tax)`,
    [incurredOn, category || null, vendor || null, Number(amount) || 0, note || null, source, extId, taxOrNull(tax)]
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
     ON CONFLICT (match_text) DO UPDATE SET category = EXCLUDED.category, tax_mode = EXCLUDED.tax_mode
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
    `SELECT id, vendor, note, category, tax FROM expenses
      WHERE ${onlyUncategorised ? "(category IS NULL OR category = '' OR category = 'Other' OR tax IS NULL)" : 'true'}`
  );
  let categorised = 0, taxed = 0;
  for (const r of rows) {
    const hit = matchRule(rules, r.vendor, r.note);
    if (!hit) continue;
    const sets = [];
    const args = [r.id];
    const generic = !r.category || r.category === 'Other';
    if (hit.category && generic) { args.push(hit.category); sets.push(`category = $${args.length}`); categorised++; }
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
  'www', 'com', 'ca', 'http', 'https'
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
    `SELECT id, vendor, note, amount, category, tax FROM expenses
      WHERE category IS NULL OR category = '' OR category = 'Other' OR tax IS NULL
      ORDER BY incurred_on DESC LIMIT 4000`
  );
  if (!rows.length) return [];

  const groups = new Map();
  for (const r of rows) {
    const text = `${r.vendor || ''} ${r.note || ''}`;
    // Already covered by a rule the owner wrote — don't suggest it again.
    if (matchRule(existing, r.vendor, r.note)) continue;
    for (const token of descriptorTokens(text)) {
      const g = groups.get(token) || { token, count: 0, total: 0, samples: [], needsCategory: 0, needsTax: 0 };
      g.count += 1;
      g.total = Math.round((g.total + n(r.amount)) * 100) / 100;
      if (!r.category || r.category === 'Other') g.needsCategory += 1;
      if (r.tax == null) g.needsTax += 1;
      if (g.samples.length < 3 && !g.samples.includes(text.trim())) g.samples.push(text.trim().slice(0, 90));
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
  if (!hasDb()) return { sellable: 0, salvage: 0, unlisted: 0, total: 0, sellableUnits: 0, salvageUnits: 0, unlistedUnits: 0 };
  const one = async (sql) => { try { return (await query(sql)).rows[0] || {}; } catch { return {}; } };
  const live = await one("SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM products WHERE active = true AND sold_at IS NULL");
  // Bought and owned, but not on the storefront — untested, being repaired, held
  // back. Sold units are excluded: their cost has already left via COGS.
  const held = await one("SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM products WHERE active = false AND sold_at IS NULL");
  const salv = await one("SELECT COUNT(*) AS c, COALESCE(SUM(cost),0) AS v FROM salvage_units WHERE status <> 'disposed'");
  const r = {
    sellable: round2(n(live.v)), sellableUnits: Number(live.c) || 0,
    unlisted: round2(n(held.v)), unlistedUnits: Number(held.c) || 0,
    salvage: round2(n(salv.v)), salvageUnits: Number(salv.c) || 0
  };
  return { ...r, total: round2(r.sellable + r.unlisted + r.salvage) };
}
