// Who is owed what, and what has been paid. A balance is owed minus paid, per person.
//
// The COST of wages is booked exactly once:
//   cash  -> this creates the expense (source 'cash', category Wages), which also lowers the cash in the till
//   bank  -> NO new expense: the bank feed already has the e-transfer; this links to that line and marks it Wages
// "Owed" rows are typed from the payroll figure for a period; they are not costs by themselves.
import { query, hasDb } from './db';
import { upsertExpense } from './finance';
import { torontoToday } from './constants';

const DDL = `
CREATE TABLE IF NOT EXISTS pay_ledger (
  id serial PRIMARY KEY, person text NOT NULL, kind text NOT NULL CHECK (kind IN ('owed','paid')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0), period_start date, period_end date, paid_on date,
  how text CHECK (how IS NULL OR how IN ('cash','bank')), expense_id int, note text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, voided_by text);
CREATE INDEX IF NOT EXISTS idx_pay_ledger_person ON pay_ledger (lower(person), kind) WHERE voided_at IS NULL;
ALTER TABLE pay_ledger ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_ledger_hours_week ON pay_ledger (lower(person), period_start) WHERE kind = 'owed' AND source = 'hours' AND voided_at IS NULL;`;
let ready = false;
export async function ensurePayLedgerSchema() { if (ready) return; await query(DDL); ready = true; }

const c2 = (v) => Math.round(Number(v) * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, max = 120) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function addOwed({ person, periodStart, periodEnd, amount, note, by }) {
  await ensurePayLedgerSchema();
  const who = clean(person);
  if (!who) throw new Error('Say who it is owed to.');
  const a = c2(amount);
  if (!(a > 0)) throw new Error('Enter the amount owed.');
  if (!DAY.test(String(periodStart || '')) || !DAY.test(String(periodEnd || ''))) throw new Error('Give the first and last day of the pay period.');
  if (periodEnd < periodStart) throw new Error('The period ends before it starts.');
  const { rows } = await query(
    `INSERT INTO pay_ledger (person, kind, amount, period_start, period_end, note, created_by) VALUES ($1,'owed',$2,$3,$4,$5,$6) RETURNING id`,
    [who, a, periodStart, periodEnd, clean(note, 300), by || null]);
  return rows[0].id;
}

// Bank lines that could be this payment: same charged amount, near the date, not already taken by a receipt or another payment.
export async function payCandidates({ amount, date, daysBefore = 3, daysAfter = 10 }) {
  await ensurePayLedgerSchema();
  const d = DAY.test(String(date || '')) ? date : torontoToday();
  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT e.id, COALESCE(e.payee_override, e.vendor) AS who, to_char(e.incurred_on,'YYYY-MM-DD') AS d, e.amount, e.tax
         FROM expenses e
        WHERE e.source = 'plaid'
          AND ROUND((e.amount + COALESCE(e.tax,0))::numeric, 2) = ROUND($1::numeric, 2)
          AND e.incurred_on BETWEEN ($2::date - $3::int) AND ($2::date + $4::int)
          AND NOT EXISTS (SELECT 1 FROM pay_ledger p WHERE p.expense_id = e.id AND p.voided_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.expense_id = e.id AND r.voided_at IS NULL)
        ORDER BY e.incurred_on, e.id LIMIT 8`, [c2(amount), d, daysBefore, daysAfter]));
  } catch { rows = []; }
  return rows.map((x) => ({ id: x.id, who: x.who, date: x.d, gross: c2(Number(x.amount) + Number(x.tax || 0)) }));
}

// Mark a bank line as wages paid to this person. The charge stays as the bank reported it (gross) with no HST inside.
async function claimBankLine(expenseId, person, by) {
  const { rows } = await query(`SELECT id, amount, tax, source FROM expenses WHERE id = $1`, [Number(expenseId)]);
  const e = rows[0];
  if (!e || e.source !== 'plaid') throw new Error('That is not a bank line.');
  const taken = await query(
    `SELECT 1 FROM pay_ledger WHERE expense_id = $1 AND voided_at IS NULL
     UNION ALL SELECT 1 FROM receipts WHERE expense_id = $1 AND voided_at IS NULL`, [e.id]).catch(() => ({ rowCount: 0 }));
  if (taken.rowCount) throw new Error('That bank line is already used by a receipt or another payment.');
  await query(
    `UPDATE expenses SET category = 'Wages', amount = amount + COALESCE(tax, 0), tax = 0, payee_override = $2,
            cat_source = 'manual', reviewed_at = COALESCE(reviewed_at, now()), reviewed_by = COALESCE(reviewed_by, $3) WHERE id = $1`,
    [e.id, person, by || null]);
  return { gross: c2(Number(e.amount) + Number(e.tax || 0)) };
}

export async function addPayment({ person, amount, date, how, expenseId, periodStart, periodEnd, note, by }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensurePayLedgerSchema();
  const who = clean(person);
  if (!who) throw new Error('Say who was paid.');
  if (!['cash', 'bank'].includes(how)) throw new Error('Say whether it was cash from the till or a bank transfer.');
  let a = c2(amount);
  const d = DAY.test(String(date || '')) ? date : torontoToday();
  let linked = null;
  if (how === 'bank' && expenseId) {
    const { rows } = await query(`SELECT amount, tax FROM expenses WHERE id = $1`, [Number(expenseId)]);
    if (!rows[0]) throw new Error('No such bank line.');
    const gross = c2(Number(rows[0].amount) + Number(rows[0].tax || 0));
    if (!(a > 0)) a = gross;
    if (a !== gross) throw new Error(`That bank line is $${gross.toFixed(2)}, not $${a.toFixed(2)}.`);
  }
  if (!(a > 0)) throw new Error('Enter the amount paid.');
  const ps = DAY.test(String(periodStart || '')) ? periodStart : null;
  const pe = DAY.test(String(periodEnd || '')) ? periodEnd : null;
  const { rows } = await query(
    `INSERT INTO pay_ledger (person, kind, amount, period_start, period_end, paid_on, how, note, created_by)
     VALUES ($1,'paid',$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [who, a, ps, pe, d, how, clean(note, 300), by || null]);
  const id = rows[0].id;
  try {
    if (how === 'cash') {
      const extId = `pay:${id}`;
      await upsertExpense({
        incurredOn: d, category: 'Wages', vendor: who, amount: a, tax: 0,
        note: `Pay #${id} · cash${ps ? ` · ${ps}..${pe || ps}` : ''}`, extId, source: 'cash', catSource: 'manual'
      });
      const { rows: er } = await query(
        `UPDATE expenses SET reviewed_at = now(), reviewed_by = $2, cat_source = 'manual' WHERE ext_id = $1 RETURNING id`, [extId, by || null]);
      await query('UPDATE pay_ledger SET expense_id = $2 WHERE id = $1', [id, er[0]?.id || null]);
    } else {
      let line = expenseId ? Number(expenseId) : null;
      if (!line) { const c = await payCandidates({ amount: a, date: d }); if (c.length === 1) line = c[0].id; }
      if (line) { await claimBankLine(line, who, by); await query('UPDATE pay_ledger SET expense_id = $2 WHERE id = $1', [id, line]); linked = line; }
    }
  } catch (e) {
    await query('DELETE FROM expenses WHERE ext_id = $1', [`pay:${id}`]).catch(() => {});
    await query('DELETE FROM pay_ledger WHERE id = $1', [id]).catch(() => {});
    throw e;
  }
  return { id, linked: !!linked };
}

// A bank payment recorded before the bank showed it links itself when exactly one line fits.
export async function linkWaitingPayments() {
  await ensurePayLedgerSchema();
  const { rows } = await query(
    `SELECT id, person, amount, to_char(paid_on,'YYYY-MM-DD') AS d, created_by FROM pay_ledger
      WHERE kind = 'paid' AND how = 'bank' AND expense_id IS NULL AND voided_at IS NULL ORDER BY id LIMIT 100`);
  let n = 0;
  for (const p of rows) {
    try {
      const c = await payCandidates({ amount: p.amount, date: p.d });
      if (c.length !== 1) continue;
      await claimBankLine(c[0].id, p.person, 'auto');
      await query('UPDATE pay_ledger SET expense_id = $2 WHERE id = $1', [p.id, c[0].id]);
      n++;
    } catch { /* leave it waiting */ }
  }
  return n;
}

export async function voidPayLine(id, by) {
  await ensurePayLedgerSchema();
  const { rows } = await query(`SELECT * FROM pay_ledger WHERE id = $1 AND voided_at IS NULL`, [Number(id)]);
  const r = rows[0];
  if (!r) throw new Error('Already voided.');
  if (r.kind === 'paid' && r.how === 'cash') await query('DELETE FROM expenses WHERE ext_id = $1', [`pay:${r.id}`]);
  await query('UPDATE pay_ledger SET voided_at = now(), voided_by = $2 WHERE id = $1', [r.id, by || null]);
}

// Pure: one person's lines → owed, paid, balance.
export function balanceOf(lines) {
  let owed = 0, paid = 0;
  for (const l of lines) { if (l.kind === 'owed') owed += l.amount; else paid += l.amount; }
  return { owed: c2(owed), paid: c2(paid), balance: c2(owed - paid) };
}

export async function payBalances() {
  if (!hasDb()) return { people: [], names: [] };
  await ensurePayLedgerSchema();
  const { rows } = await query(
    `SELECT id, person, kind, amount, to_char(period_start,'YYYY-MM-DD') AS ps, to_char(period_end,'YYYY-MM-DD') AS pe,
            to_char(paid_on,'YYYY-MM-DD') AS paid_on, how, expense_id, note, source
       FROM pay_ledger WHERE voided_at IS NULL ORDER BY COALESCE(paid_on, period_end) DESC, id DESC`);
  const by = new Map();
  for (const r of rows) {
    const k = nameKey(r.person);
    if (!by.has(k)) by.set(k, { person: r.person, lines: [] });
    by.get(k).lines.push({ id: r.id, kind: r.kind, amount: Number(r.amount), periodStart: r.ps, periodEnd: r.pe, paidOn: r.paid_on,
      how: r.how, note: r.note, source: r.source, waitingForBank: r.kind === 'paid' && r.how === 'bank' && !r.expense_id });
  }
  const people = [...by.values()].map((p) => ({ ...p, ...balanceOf(p.lines) })).sort((a, b) => b.balance - a.balance || a.person.localeCompare(b.person));
  let emp = [];
  try { emp = (await query(`SELECT name FROM employees WHERE active = true ORDER BY name`)).rows.map((r) => r.name).filter(Boolean); } catch { /* none */ }
  const names = [...new Set([...emp, ...people.map((p) => p.person)])];
  return { people, names };
}
