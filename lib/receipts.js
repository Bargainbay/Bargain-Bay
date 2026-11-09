// Receipts: what was bought, how it was paid, whether the bank has it, whether somebody is owed it back.
//
// Where the COST comes from depends on how it was paid, so it is booked exactly once:
//   cash      -> this creates the expense (source 'cash'); it also lowers cash on hand
//   personal  -> this creates the expense (source 'personal'); no bank/cash movement; owed back until reimbursed
//   bank      -> NO expense is created: the bank feed already carries it. The receipt LINKS to that line and
//                hands it the category and HST. Until the bank shows it, the receipt is "waiting for the bank".
// Reimbursing a personal receipt through the bank removes the bank's e-transfer line from the expenses, because
// the cost is already booked from the receipt and paying somebody back is not a second cost.
import { put, get } from '@vercel/blob';
import { query, hasDb } from './db';
import { upsertExpense, deleteExpense, EXPENSE_CATEGORIES, getCustomCategories } from './finance';
import { torontoToday } from './constants';
import { addEntry } from './bankroll';
import { ensurePayLedgerSchema } from './pay-ledger';

const DDL = `
CREATE TABLE IF NOT EXISTS receipts (
  id serial PRIMARY KEY, receipt_date date NOT NULL, vendor text,
  total numeric(12,2) NOT NULL CHECK (total > 0), tax numeric(12,2), category text,
  paid_with text NOT NULL CHECK (paid_with IN ('cash','bank','personal')), paid_by text, photo_path text, expense_id int,
  reimburse_status text NOT NULL DEFAULT 'none' CHECK (reimburse_status IN ('none','owed','reimbursed')),
  reimbursed_on date, reimbursed_how text, reimbursed_note text, reimbursed_by text, note text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, voided_by text);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts (receipt_date DESC, id DESC);`;
let ready = false;
export async function ensureReceiptSchema() { if (ready) return; await query(DDL); ready = true; }

const c2 = (v) => Math.round(Number(v) * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const PAID_WITH = { cash: 'Cash from the till', bank: 'Business card / bank', personal: 'Out of my own pocket' };
export const MAX_BYTES = 12 * 1024 * 1024;

// Pure: the cost/tax split. The receipt total is what was charged; tax, when known, is inside it.
export function splitReceipt(total, tax) {
  const t = c2(total);
  if (tax == null || tax === '') return { amount: t, tax: null };
  const x = c2(tax);
  return { amount: c2(t - x), tax: x };
}

async function put_photo(id, file) {
  if (!file || !(file.size > 0)) return null;
  if (file.size > MAX_BYTES) throw new Error('That photo is too big.');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Photo storage is not configured (BLOB_READ_WRITE_TOKEN).');
  const path = `receipts/${id}-${Date.now()}.jpg`;
  await put(path, file, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: file.type || 'image/jpeg' });
  return path;
}

export async function receiptPhoto(id) {
  await ensureReceiptSchema();
  const { rows } = await query('SELECT photo_path FROM receipts WHERE id = $1', [Number(id)]);
  const path = rows[0]?.photo_path;
  if (!path) return null;
  const res = await get(path, { access: 'private' });
  return res && res.statusCode === 200 && res.stream ? res : null;
}

export async function createReceipt({ date, vendor, total, tax, category, paidWith, paidBy, reimburse = true, note, photo, by }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureReceiptSchema();
  const t = c2(total);
  if (!Number.isFinite(t) || t <= 0) throw new Error('Enter the total on the receipt.');
  if (!PAID_WITH[paidWith]) throw new Error('Say how it was paid.');
  const who = String(paidBy || '').trim();
  if (paidWith === 'personal' && !who) throw new Error('Say whose own money it came out of.');
  const taxN = tax == null || tax === '' ? null : c2(tax);
  if (taxN != null && (taxN < 0 || taxN > t)) throw new Error('The tax cannot be more than the total.');
  const d = DAY.test(String(date || '')) ? date : torontoToday();
  const cat = [...EXPENSE_CATEGORIES, ...(await getCustomCategories().catch(() => []))].includes(category) ? category : 'Other';
  const status = paidWith === 'personal' && reimburse ? 'owed' : 'none';

  const { rows } = await query(
    `INSERT INTO receipts (receipt_date, vendor, total, tax, category, paid_with, paid_by, reimburse_status, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [d, String(vendor || '').trim().slice(0, 120) || null, t, taxN, cat, paidWith, paidWith === 'personal' ? who : null, status,
      String(note || '').trim().slice(0, 300) || null, by || null]);
  const id = rows[0].id;
  try {
    const path = await put_photo(id, photo);
    if (path) await query('UPDATE receipts SET photo_path = $2 WHERE id = $1', [id, path]);
    if (paidWith === 'cash' || paidWith === 'personal') {
      const s = splitReceipt(t, taxN);
      const extId = `receipt:${id}`;
      await upsertExpense({
        incurredOn: d, category: cat, vendor: String(vendor || '').trim() || 'Receipt', amount: s.amount, tax: s.tax,
        note: `Receipt #${id}${paidWith === 'personal' ? ` · paid by ${who}` : ' · cash'}${note ? ` · ${String(note).trim()}` : ''}`,
        extId, source: paidWith === 'cash' ? 'cash' : 'personal', catSource: 'manual'
      });
      // Typed by a person, so it is already reviewed: it must not land in the bank's "to review" queue.
      const { rows: er } = await query(
        `UPDATE expenses SET reviewed_at = now(), reviewed_by = $2, cat_source = 'manual' WHERE ext_id = $1 RETURNING id`, [extId, by || null]);
      await query('UPDATE receipts SET expense_id = $2 WHERE id = $1', [id, er[0]?.id || null]);
    } else {
      await matchBankLine(id);
    }
  } catch (e) {
    // Half-made is worse than not made: take the row back out so nothing is counted twice or left orphaned.
    await query('DELETE FROM expenses WHERE ext_id = $1', [`receipt:${id}`]).catch(() => {});
    await query('DELETE FROM receipts WHERE id = $1', [id]).catch(() => {});
    throw e;
  }
  return id;
}

// Bank lines that could be this receipt: same charged amount, near the date, and not taken by another receipt.
export async function bankCandidates(receiptId, { daysBefore = 3, daysAfter = 10, afterOnly = false } = {}) {
  await ensureReceiptSchema();
  await ensurePayLedgerSchema();
  const { rows: rr } = await query(
    `SELECT total, to_char(receipt_date,'YYYY-MM-DD') AS d FROM receipts WHERE id = $1`, [Number(receiptId)]);
  const r = rr[0];
  if (!r) return [];
  const { rows } = await query(
    `SELECT e.id, e.vendor, COALESCE(e.payee_override, e.vendor) AS who, to_char(e.incurred_on,'YYYY-MM-DD') AS d, e.amount, e.tax
       FROM expenses e
      WHERE e.source = 'plaid'
        AND ROUND((e.amount + COALESCE(e.tax,0))::numeric, 2) = ROUND($1::numeric, 2)
        AND e.incurred_on BETWEEN ($2::date - $3::int) AND ($2::date + $4::int)
        AND NOT EXISTS (SELECT 1 FROM receipts x WHERE x.expense_id = e.id AND x.voided_at IS NULL AND x.id <> $5)
        AND NOT EXISTS (SELECT 1 FROM pay_ledger p WHERE p.expense_id = e.id AND p.voided_at IS NULL)
      ORDER BY e.incurred_on, e.id LIMIT 8`,
    [r.total, r.d, afterOnly ? 0 : daysBefore, daysAfter, Number(receiptId)]);
  return rows.map((x) => ({ id: x.id, who: x.who, date: x.d, gross: c2(Number(x.amount) + Number(x.tax || 0)) }));
}

export async function linkReceiptToBank(receiptId, expenseId, by) {
  await ensureReceiptSchema();
  const { rows } = await query('SELECT * FROM receipts WHERE id = $1 AND voided_at IS NULL', [Number(receiptId)]);
  const r = rows[0];
  if (!r) throw new Error('No such receipt.');
  if (r.paid_with !== 'bank') throw new Error('Only a receipt paid by card or bank links to a bank line.');
  const { rows: er } = await query(`SELECT id, amount, tax, source FROM expenses WHERE id = $1`, [Number(expenseId)]);
  const e = er[0];
  if (!e || e.source !== 'plaid') throw new Error('That is not a bank line.');
  if (c2(Number(e.amount) + Number(e.tax || 0)) !== c2(r.total)) throw new Error('That bank line is a different amount from the receipt.');
  const taken = await query('SELECT 1 FROM receipts WHERE expense_id = $1 AND voided_at IS NULL AND id <> $2', [e.id, r.id]);
  if (taken.rowCount) throw new Error('Another receipt already has that bank line.');
  const s = splitReceipt(r.total, r.tax);
  // The receipt knows what it was for and what tax was inside it; the bank only knows the charge.
  await query(
    `UPDATE expenses SET category = $2, amount = $3, tax = $4, payee_override = COALESCE(payee_override, $5),
            cat_source = 'manual', reviewed_at = COALESCE(reviewed_at, now()), reviewed_by = COALESCE(reviewed_by, $6)
      WHERE id = $1`, [e.id, r.category || 'Other', s.amount, s.tax, r.vendor || null, by || null]);
  await query('UPDATE receipts SET expense_id = $2 WHERE id = $1', [r.id, e.id]);
  return true;
}

// Link when there is exactly one possible bank line; with two or more the choice is a person's.
export async function matchBankLine(receiptId) {
  const c = await bankCandidates(receiptId);
  if (c.length !== 1) return null;
  await linkReceiptToBank(receiptId, c[0].id, 'auto');
  return c[0];
}

export async function linkWaitingReceipts() {
  await ensureReceiptSchema();
  const { rows } = await query(
    `SELECT id FROM receipts WHERE paid_with = 'bank' AND expense_id IS NULL AND voided_at IS NULL ORDER BY id LIMIT 100`);
  let linked = 0;
  for (const r of rows) { try { if (await matchBankLine(r.id)) linked++; } catch { /* leave it waiting */ } }
  return linked;
}

export async function markReimbursed(id, { how, on, note, bankExpenseId, by }) {
  await ensureReceiptSchema();
  const { rows } = await query(`SELECT * FROM receipts WHERE id = $1 AND voided_at IS NULL`, [Number(id)]);
  const r = rows[0];
  if (!r) throw new Error('No such receipt.');
  if (r.paid_with !== 'personal' || r.reimburse_status !== 'owed') throw new Error('That receipt is not waiting to be paid back.');
  if (!['bank', 'cash', 'other'].includes(how)) throw new Error('Say how they were paid back.');
  const d = DAY.test(String(on || '')) ? on : torontoToday();
  let detail = String(note || '').trim().slice(0, 300);
  if (how === 'bank' && bankExpenseId) {
    const cands = await bankCandidates(id, { afterOnly: true, daysAfter: 120 });
    const line = cands.find((c) => Number(c.id) === Number(bankExpenseId));
    if (!line) throw new Error('That bank line does not match the receipt amount, or is already used.');
    // The cost is already booked from the receipt; the e-transfer paying it back is not a second cost.
    await deleteExpense(line.id);
    detail = `${detail ? detail + ' · ' : ''}paid back by bank line ${line.date} ${line.who || ''} $${line.gross.toFixed(2)} (taken out of expenses so it is not counted twice)`;
  }
  if (how === 'cash') await addEntry({ date: d, kind: 'cash', amount: -c2(r.total), note: `Paid back ${r.paid_by} for receipt #${r.id}`, by });
  await query(
    `UPDATE receipts SET reimburse_status = 'reimbursed', reimbursed_on = $2, reimbursed_how = $3, reimbursed_note = $4, reimbursed_by = $5 WHERE id = $1`,
    [r.id, d, how, detail || null, by || null]);
}

export async function voidReceipt(id, by) {
  await ensureReceiptSchema();
  const { rows } = await query(`SELECT * FROM receipts WHERE id = $1 AND voided_at IS NULL`, [Number(id)]);
  const r = rows[0];
  if (!r) throw new Error('Already voided.');
  if (r.reimburse_status === 'reimbursed' && r.reimbursed_how === 'bank') throw new Error('That one was paid back through the bank, so it cannot be voided without breaking the books. Ask for a correction.');
  if (r.paid_with !== 'bank') await query('DELETE FROM expenses WHERE ext_id = $1', [`receipt:${r.id}`]);
  await query('UPDATE receipts SET voided_at = now(), voided_by = $2 WHERE id = $1', [r.id, by || null]);
}

export async function listReceipts(limit = 200) {
  if (!hasDb()) return [];
  await ensureReceiptSchema();
  const { rows } = await query(
    `SELECT r.*, to_char(r.receipt_date,'YYYY-MM-DD') AS d, to_char(r.reimbursed_on,'YYYY-MM-DD') AS rd,
            to_char(e.incurred_on,'YYYY-MM-DD') AS bank_date, COALESCE(e.payee_override, e.vendor) AS bank_who
       FROM receipts r LEFT JOIN expenses e ON e.id = r.expense_id AND r.paid_with = 'bank'
      WHERE r.voided_at IS NULL ORDER BY r.receipt_date DESC, r.id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id, date: r.d, vendor: r.vendor, total: Number(r.total), tax: r.tax == null ? null : Number(r.tax), category: r.category,
    paidWith: r.paid_with, paidBy: r.paid_by, hasPhoto: !!r.photo_path, note: r.note,
    // For a card/bank receipt: has the bank shown the charge yet?
    bank: r.paid_with === 'bank' ? (r.expense_id ? { state: 'linked', date: r.bank_date, who: r.bank_who } : { state: 'waiting' }) : null,
    reimburse: r.reimburse_status, reimbursedOn: r.rd, reimbursedHow: r.reimbursed_how, reimbursedNote: r.reimbursed_note
  }));
}
