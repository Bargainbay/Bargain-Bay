// Accountant access — granted by email, revocable, no deploy involved.
//
// Every other role here lives in an env var (ADMIN_EMAILS, SALES_EMAILS), which
// is fine for people who work here and wrong for this one: an accountant is
// brought in for a season, given the books, and cut off again. That has to be
// two clicks, not a redeploy, and it has to leave a record of who let them in
// and when.
//
// What they get is deliberately narrow: the money surfaces, and the bookkeeping
// actions that ARE the job (categorising an expense, answering its HST). Not
// orders, not inventory, not pricing, not payroll, and not the connect/disconnect
// buttons on the feeds — linking a bank account is an access grant of its own.
import { query, hasDb } from './db';
import { normalizeEmail } from './auth';

let ensured = null;
function ensureAccountantSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      CREATE TABLE IF NOT EXISTS accountant_access (
        email      text PRIMARY KEY,
        name       text,
        note       text,
        granted_by text,
        granted_at timestamptz NOT NULL DEFAULT now(),
        -- Revoking sets this rather than deleting the row: who had the books,
        -- and when, is exactly the sort of thing somebody asks about later.
        revoked_at timestamptz,
        revoked_by text
      );
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function listAccountants() {
  if (!hasDb()) return [];
  await ensureAccountantSchema();
  const { rows } = await query('SELECT * FROM accountant_access ORDER BY revoked_at NULLS FIRST, granted_at DESC');
  return rows.map((r) => ({
    email: r.email,
    name: r.name || '',
    note: r.note || '',
    grantedBy: r.granted_by || null,
    grantedAt: r.granted_at ? r.granted_at.toISOString() : null,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    revokedBy: r.revoked_by || null,
    active: !r.revoked_at
  }));
}

// Re-granting someone previously revoked clears the revocation rather than
// failing on the primary key — people come back for next year's return.
export async function grantAccountant({ email, name, note, by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureAccountantSchema();
  const e = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Enter a valid email address.');
  await query(
    `INSERT INTO accountant_access (email, name, note, granted_by)
       VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, accountant_access.name),
       note = COALESCE(EXCLUDED.note, accountant_access.note),
       granted_by = EXCLUDED.granted_by,
       granted_at = now(),
       revoked_at = NULL,
       revoked_by = NULL`,
    [e, String(name || '').trim() || null, String(note || '').trim() || null,
     normalizeEmail(by) || null]
  );
  return e;
}

export async function revokeAccountant(email, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureAccountantSchema();
  const e = normalizeEmail(email);
  await query(
    'UPDATE accountant_access SET revoked_at = now(), revoked_by = $2 WHERE email = $1 AND revoked_at IS NULL',
    [e, normalizeEmail(by) || null]
  );
  return e;
}

// Checked on every request to a money surface, so it must fail CLOSED and must
// never throw a page down: no database, no accountant.
export async function isAccountant(session) {
  const e = normalizeEmail(session?.email);
  if (!e || !hasDb()) return false;
  try {
    await ensureAccountantSchema();
    const { rows } = await query(
      'SELECT 1 FROM accountant_access WHERE email = $1 AND revoked_at IS NULL LIMIT 1', [e]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
