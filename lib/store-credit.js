// Store credit. A cancelled order's deposit, less the restocking fee, becomes a
// CODE the customer (or anyone they give it to) can spend on a later sale.
//
// The balance is never stored: it is SUM(store_credit_entries.amount), and that
// table is append-only (a trigger refuses UPDATE/DELETE), so every dollar has a
// trail. Same rule as a part's stock and a seller's balance. No expiry.
//
// In the books a credit is a liability (2170) from the day it is issued; spending
// it is a TENDER on the new invoice (an invoice payment with method 'Store
// credit'), not a discount, so HST is charged on the full new sale.
import { randomBytes } from 'node:crypto';
import { hasDb, query, withTransaction } from './db';
import { round2 } from './constants';

export const STORE_CREDIT_METHOD_LABEL = 'Store credit';

// Without 0/O/1/I/L so a code read over the phone is typed back correctly.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeCreditCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('SC') ? s.slice(2) : s;
  if (body.length !== 8) return null;
  return `SC-${body.slice(0, 4)}-${body.slice(4)}`;
}

function newCode() {
  const bytes = randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return `SC-${body.slice(0, 4)}-${body.slice(4)}`;
}

let _schema = null;
export function ensureStoreCreditSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS store_credits (
        id serial PRIMARY KEY, code text NOT NULL UNIQUE,
        issued_to_name text, issued_to_email text, invoice_id int, invoice_number text,
        note text, created_by text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS store_credit_entries (
        id serial PRIMARY KEY, credit_id int NOT NULL REFERENCES store_credits(id),
        amount numeric(10,2) NOT NULL,
        kind text NOT NULL CHECK (kind IN ('issued','used','adjustment')),
        invoice_id int, order_id int, ref text, note text, created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((kind = 'issued' AND amount > 0) OR (kind = 'used' AND amount < 0) OR kind = 'adjustment'));
      CREATE INDEX IF NOT EXISTS idx_store_credit_entries_credit ON store_credit_entries(credit_id);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

const BAL = '(SELECT COALESCE(SUM(e.amount),0) FROM store_credit_entries e WHERE e.credit_id = c.id)';

// Issue a new credit. Pass `client` to do it inside the caller's transaction.
export async function issueStoreCredit({ amount, invoiceId = null, invoiceNumber = null, orderId = null, name = null, email = null, by = null, note = null }, client = null) {
  const amt = round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Store credit must be more than zero.');
  await ensureStoreCreditSchema();
  const run = async (c) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const { rows } = await c.query(
        `INSERT INTO store_credits (code, issued_to_name, issued_to_email, invoice_id, invoice_number, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, name || null, String(email || '').trim().toLowerCase() || null, invoiceId, invoiceNumber,
         note ? String(note).slice(0, 300) : null, String(by || '').trim().toLowerCase() || null]
      );
      if (!rows.length) continue;
      await c.query(
        `INSERT INTO store_credit_entries (credit_id, amount, kind, invoice_id, order_id, note, created_by)
         VALUES ($1,$2,'issued',$3,$4,$5,$6)`,
        [rows[0].id, amt, invoiceId, orderId, note ? String(note).slice(0, 300) : null, String(by || '').trim().toLowerCase() || null]
      );
      return { id: rows[0].id, code, amount: amt };
    }
    throw new Error('Could not generate a unique store credit code.');
  };
  return client ? run(client) : withTransaction(run);
}

export async function getStoreCredit(rawCode) {
  const code = normalizeCreditCode(rawCode);
  if (!code) return null;
  if (!hasDb()) return null;
  await ensureStoreCreditSchema();
  const { rows } = await query(
    `SELECT c.id, c.code, c.issued_to_name, c.issued_to_email, c.invoice_number, c.created_at, ${BAL} AS balance
       FROM store_credits c WHERE c.code = $1`, [code]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, code: r.code, balance: round2(Number(r.balance) || 0),
           issuedToName: r.issued_to_name, issuedToEmail: r.issued_to_email,
           invoiceNumber: r.invoice_number, createdAt: r.created_at };
}

// Take `amount` off a credit, inside the caller's transaction. Serialised per
// credit so two checkouts cannot both spend the same dollars. Returns what was
// actually taken (never more than the balance) — pass `exact: true` to refuse
// instead of taking less.
export async function spendStoreCredit(client, rawCode, amount, { invoiceId = null, orderId = null, ref = null, by = null, exact = false } = {}) {
  const code = normalizeCreditCode(rawCode);
  if (!code) throw new Error('That store credit code is not valid.');
  const want = round2(Number(amount));
  if (!Number.isFinite(want) || want <= 0) throw new Error('Nothing to apply.');
  await ensureStoreCreditSchema();
  const { rows: cr } = await client.query('SELECT id FROM store_credits WHERE code = $1', [code]);
  if (!cr.length) throw new Error('That store credit code was not found.');
  const id = cr[0].id;
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [4917, id]);
  const { rows: b } = await client.query('SELECT COALESCE(SUM(amount),0) AS bal FROM store_credit_entries WHERE credit_id = $1', [id]);
  const balance = round2(Number(b[0].bal) || 0);
  if (balance <= 0.004) throw new Error('That store credit has no balance left.');
  if (exact && want > balance + 0.004) throw new Error(`That store credit only has $${balance.toFixed(2)} left.`);
  const take = round2(Math.min(want, balance));
  await client.query(
    `INSERT INTO store_credit_entries (credit_id, amount, kind, invoice_id, order_id, ref, created_by)
     VALUES ($1,$2,'used',$3,$4,$5,$6)`,
    [id, -take, invoiceId, orderId, ref, String(by || '').trim().toLowerCase() || null]
  );
  return { code, id, taken: take, balanceAfter: round2(balance - take) };
}

// Put back what a spend took (the sale it was for fell through). An adjustment,
// never an edit of the original row.
export async function restoreStoreCredit(rawCode, amount, { note = 'Restored', by = null, invoiceId = null, orderId = null } = {}) {
  const code = normalizeCreditCode(rawCode);
  const amt = round2(Number(amount));
  if (!code || !(amt > 0)) return null;
  await ensureStoreCreditSchema();
  const { rows } = await query('SELECT id FROM store_credits WHERE code = $1', [code]);
  if (!rows.length) return null;
  await query(
    `INSERT INTO store_credit_entries (credit_id, amount, kind, invoice_id, order_id, note, created_by)
     VALUES ($1,$2,'adjustment',$3,$4,$5,$6)`,
    [rows[0].id, amt, invoiceId, orderId, String(note).slice(0, 300), String(by || '').trim().toLowerCase() || null]
  );
  return { code, restored: amt };
}

export async function listStoreCredits({ q = '', limit = 200 } = {}) {
  if (!hasDb()) return [];
  await ensureStoreCreditSchema();
  const term = `%${String(q || '').trim().toLowerCase()}%`;
  const { rows } = await query(
    `SELECT c.id, c.code, c.issued_to_name, c.issued_to_email, c.invoice_number, c.created_at, c.created_by,
            ${BAL} AS balance,
            (SELECT COALESCE(SUM(e.amount),0) FROM store_credit_entries e WHERE e.credit_id = c.id AND e.kind = 'issued') AS issued
       FROM store_credits c
      WHERE $1 = '%%' OR lower(c.code) LIKE $1 OR lower(COALESCE(c.issued_to_email,'')) LIKE $1
         OR lower(COALESCE(c.issued_to_name,'')) LIKE $1 OR lower(COALESCE(c.invoice_number,'')) LIKE $1
      ORDER BY c.created_at DESC, c.id DESC LIMIT $2`, [term, Math.min(500, limit)]);
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.issued_to_name, email: r.issued_to_email, invoiceNumber: r.invoice_number,
    issued: round2(Number(r.issued) || 0), balance: round2(Number(r.balance) || 0),
    createdAt: r.created_at, createdBy: r.created_by
  }));
}

export async function storeCreditHistory(rawCode) {
  const code = normalizeCreditCode(rawCode);
  if (!code || !hasDb()) return [];
  await ensureStoreCreditSchema();
  const { rows } = await query(
    `SELECT e.id, e.amount, e.kind, e.invoice_id, e.order_id, e.ref, e.note, e.created_by, e.created_at
       FROM store_credit_entries e JOIN store_credits c ON c.id = e.credit_id
      WHERE c.code = $1 ORDER BY e.created_at, e.id`, [code]);
  return rows.map((r) => ({ id: r.id, amount: round2(Number(r.amount)), kind: r.kind, ref: r.ref, note: r.note, by: r.created_by, at: r.created_at }));
}

// Total owed to customers across every credit (the 2170 figure).
export async function storeCreditOutstanding() {
  if (!hasDb()) return 0;
  await ensureStoreCreditSchema();
  const { rows } = await query('SELECT COALESCE(SUM(amount),0) AS t FROM store_credit_entries');
  return round2(Number(rows[0].t) || 0);
}
