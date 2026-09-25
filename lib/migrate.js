// Numbered, recorded, transactional schema migrations.
//
// WHAT THIS REPLACES. `db/migrations/0001_baseline.sql` was one file of `CREATE TABLE IF NOT
// EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, re-run in full by a
// button on /admin, alongside twenty-seven `ensureXSchema()` functions that run
// DDL from request paths at cold start. It works — everything is idempotent —
// but nothing anywhere records WHAT HAS BEEN APPLIED. So there is no way to ask
// whether a column exists in production without going and looking, no way to
// roll anything back, no ordering between modules, and at least one CHECK
// constraint living in production that is in no file in this repo
// (jobs_type_check — lib/jobs.js says so in a comment).
//
// WHAT THIS DOES NOT DO YET, deliberately. The twenty-seven `ensure*` functions
// are left exactly where they are. They are idempotent and harmless, and moving
// them is a second change that wants a staging database in front of it (1.5).
// This lays the track: from here, a NEW schema change goes in a numbered file
// and is recorded, instead of being appended to a 1,052-line blob.
//
// Postgres has transactional DDL, which is the whole reason this is worth
// having: a migration that fails halfway leaves nothing behind.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getPool, hasDb } from './db';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

// One arbitrary, fixed key. Two instances booting at once — which is the normal
// case on a deploy — must not both try to apply 0002.
const LOCK_KEY = 8_531_204_775_119_004n;

// A migration that cannot run inside a transaction says so on its first line.
// CREATE INDEX CONCURRENTLY is the case this exists for: it does not block
// writes, which matters on a live table, and Postgres refuses it in a
// transaction. The trade is that a failure leaves a partial index behind, so
// use it only when the blocking matters more.
const NO_TX = /^--\s*migrate:no-transaction\b/m;

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

export function listMigrations(dir = MIGRATIONS_DIR) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch {
    return [];
  }
  // Filename order IS apply order, which is why they are zero-padded. Sorted
  // as strings deliberately: 0002 before 0010, and a name that does not sort
  // where its author expected is visible in a directory listing.
  return files.sort().map((name) => {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    return { id: name.replace(/\.sql$/, ''), name, sql, checksum: checksum(sql), inTransaction: !NO_TX.test(sql) };
  });
}

async function ensureLedger(client) {
  // The one piece of DDL that cannot itself be a migration.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      ms         integer
    )`);
}

/**
 * Apply everything not yet recorded.
 *
 * @returns {{ok, applied[], skipped[], alreadyApplied, error?}}
 *   `applied`  — ran now.
 *   `skipped`  — already recorded, untouched.
 */
export async function migrate({ dir = MIGRATIONS_DIR, dryRun = false, client: injected = null } = {}) {
  if (!injected && !hasDb()) return { ok: false, error: 'POSTGRES_URL is not set.', applied: [], skipped: [] };

  const migrations = listMigrations(dir);
  if (!migrations.length) return { ok: false, error: `No migrations found in ${dir}`, applied: [], skipped: [] };

  // `client` is injectable so the runner can be tested against a real Postgres
  // without one being installed (test/migrate.test.mjs drives it with PGlite).
  // Anything with .query(sql, params) will do. A caller-supplied client is the
  // caller's to close.
  const client = injected || await getPool().connect();
  const applied = [], skipped = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [String(LOCK_KEY)]);
    await ensureLedger(client);

    const { rows } = await client.query('SELECT id, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.id, r.checksum]));

    for (const m of migrations) {
      const seen = done.get(m.id);
      if (seen !== undefined) {
        // EDITING AN APPLIED MIGRATION IS REFUSED, not warned about. The file no
        // longer describes what is in the database, so every later reasoning
        // from it is wrong. Write a new migration instead.
        if (seen !== m.checksum) {
          return {
            ok: false, applied, skipped,
            error: `${m.name} has changed since it was applied (recorded ${seen}, file is ${m.checksum}). `
                 + 'An applied migration is history. Add a new one rather than editing this.'
          };
        }
        skipped.push(m.id);
        continue;
      }

      if (dryRun) { applied.push({ id: m.id, dryRun: true }); continue; }

      const started = Date.now();
      try {
        if (m.inTransaction) await client.query('BEGIN');
        await client.query(m.sql);
        const ms = Date.now() - started;
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, ms) VALUES ($1,$2,$3)',
          [m.id, m.checksum, ms]
        );
        if (m.inTransaction) await client.query('COMMIT');
        applied.push({ id: m.id, ms });
      } catch (e) {
        if (m.inTransaction) { try { await client.query('ROLLBACK'); } catch {} }
        // STOP. Later migrations may assume this one ran.
        return {
          ok: false, applied, skipped,
          error: `${m.name} failed: ${e.message}`,
          failed: m.id,
          rolledBack: m.inTransaction
        };
      }
    }
    return { ok: true, applied, skipped, alreadyApplied: skipped.length };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [String(LOCK_KEY)]); } catch {}
    if (!injected) client.release();
  }
}

/** What is applied and what is outstanding, without changing anything. */
export async function migrationStatus({ dir = MIGRATIONS_DIR, client = null } = {}) {
  if (!client && !hasDb()) return { ok: false, error: 'POSTGRES_URL is not set.' };
  const migrations = listMigrations(dir);
  const db = client || getPool();
  try {
    const { rows } = await db.query(
      'SELECT id, checksum, applied_at, ms FROM schema_migrations ORDER BY id'
    );
    const done = new Map(rows.map((r) => [r.id, r]));
    return {
      ok: true,
      migrations: migrations.map((m) => {
        const rec = done.get(m.id);
        return {
          id: m.id,
          applied: !!rec,
          appliedAt: rec?.applied_at || null,
          ms: rec?.ms ?? null,
          changedSinceApplied: !!rec && rec.checksum !== m.checksum
        };
      }),
      // Recorded in the database but with no file — somebody deleted a
      // migration, or this deployment is older than the database.
      orphans: rows.filter((r) => !migrations.some((m) => m.id === r.id)).map((r) => r.id),
      pending: migrations.filter((m) => !done.has(m.id)).map((m) => m.id)
    };
  } catch (e) {
    // No ledger table yet = nothing has ever been applied.
    if (/schema_migrations/.test(e.message)) {
      return { ok: true, migrations: migrations.map((m) => ({ id: m.id, applied: false })), orphans: [], pending: migrations.map((m) => m.id) };
    }
    return { ok: false, error: e.message };
  }
}
