// Logical backup and restore of the Postgres database.
//
// WHY THIS EXISTS WHEN NEON ALREADY HAS POINT-IN-TIME RESTORE. Neon's PITR is
// the primary mechanism and this does not replace it. It covers two things PITR
// does not:
//
//   · retention. PITR reaches back as far as the plan allows and no further, so
//     a problem discovered two months later — a bad import, a mis-priced batch —
//     is outside it.
//   · the account. PITR lives inside the Neon account. A backup you hold is the
//     one that survives losing access to it.
//
// NO pg_dump. It is not installed on Vercel, not installed on every laptop, and
// its output is version-coupled to the server that made it. This is `pg` doing
// SELECT and INSERT, which means the same code runs anywhere the app runs — and
// it can be TESTED, against a real Postgres, which a shell-out cannot be.
//
// WHAT THIS DOES NOT BACK UP, and it is most of the risk — see docs/BACKUP.md:
//   · the master tracker (a Google Sheet, not in this repo, the source of truth
//     for inventory),
//   · the Vercel Blob store: proof-of-delivery SIGNATURES and photos, unit
//     photos, driver fuel receipts. Postgres holds only the PATHS, so restoring
//     it alone gives you rows pointing at pictures that are gone.
import { getPool, hasDb } from './db';

// Ordinary application tables only. Anything Postgres manages itself is excluded.
//
// schema_migrations is excluded too, and that is not a detail. It describes the
// TARGET database's schema history, not the source's data — the target has run
// its own migrations and has its own rows. Including it means a restore either
// dies on a duplicate key (which is how this was found) or, worse, overwrites
// the target's record of what has been applied to it with somebody else's.
export const EXCLUDED_TABLES = new Set(['schema_migrations']);

const TABLE_QUERY = `
  SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname`;

// Rows are paged so a large table cannot exhaust memory. An SMB's database is
// nowhere near this, which is exactly why the limit should be explicit rather
// than discovered.
const PAGE = 2000;

export async function listTables(db, { includeExcluded = false } = {}) {
  const { rows } = await db.query(TABLE_QUERY);
  const names = rows.map((r) => r.name);
  return includeExcluded ? names : names.filter((n) => !EXCLUDED_TABLES.has(n));
}

/**
 * Dump every table to a JSON-serialisable object.
 *
 * Values come back already marshalled by the driver (jsonb as objects, text[]
 * as arrays, numeric as strings to preserve precision), and go back the same
 * way on restore, so no hand-written type formatting is involved — which is the
 * usual source of restore bugs.
 */
export async function dump({ client = null, tables = null } = {}) {
  if (!client && !hasDb()) throw new Error('POSTGRES_URL is not set.');
  const db = client || getPool();

  const names = tables || await listTables(db);
  const out = { format: 1, takenAt: new Date().toISOString(), tables: {} };

  for (const name of names) {
    const rows = [];
    // eslint-disable-next-line no-await-in-loop -- paging is sequential by nature
    for (let offset = 0; ; offset += PAGE) {
      // ctid gives a stable order on a table with no primary key. Ordering
      // matters: an unordered paged read can repeat or skip rows.
      // eslint-disable-next-line no-await-in-loop
      const page = await db.query(`SELECT * FROM "${name}" ORDER BY ctid LIMIT ${PAGE} OFFSET ${offset}`);
      rows.push(...page.rows);
      if (page.rows.length < PAGE) break;
    }
    out.tables[name] = rows;
  }
  out.rowCount = Object.values(out.tables).reduce((a, r) => a + r.length, 0);
  return out;
}

/**
 * Restore a dump into a database that ALREADY HAS THE SCHEMA.
 *
 * Run migrations first. This deliberately does not create tables: a restore
 * that also builds the schema is a restore that can silently rebuild it
 * WRONG — from whatever the dump happened to capture rather than from the
 * migrations, which are the definition.
 *
 * @param {object}  opts
 * @param {boolean} opts.truncate  empty each table first. Off by default,
 *   because emptying a database is not something to do by omission.
 */
export async function restore(dumpData, { client = null, truncate = false } = {}) {
  if (!client && !hasDb()) throw new Error('POSTGRES_URL is not set.');
  const db = client || getPool();
  if (!dumpData || !dumpData.tables) throw new Error('Not a dump: no `tables`.');

  const present = new Set(await listTables(db));
  const names = Object.keys(dumpData.tables);
  const missing = names.filter((n) => !present.has(n));
  if (missing.length) {
    throw new Error(
      `The target is missing ${missing.length} table(s): ${missing.slice(0, 5).join(', ')}. `
      + 'Run the migrations first — a restore does not build the schema.'
    );
  }

  // Foreign keys are switched off for the load rather than the rows being
  // sorted into dependency order. Dependency order is not always solvable
  // (jobs <-> invoices reference each other) and a dump is by definition a
  // consistent snapshot, so the constraints have nothing to catch.
  await db.query("SET session_replication_role = 'replica'");
  const restored = {};
  try {
    if (truncate) {
      for (const name of [...names].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        await db.query(`DELETE FROM "${name}"`);
      }
    }

    for (const name of names) {
      const rows = dumpData.tables[name];
      restored[name] = 0;
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const quoted = cols.map((c) => `"${c}"`).join(', ');

      for (const row of rows) {
        const params = cols.map((c) => {
          const v = row[c];
          // jsonb comes back as an object and has to go back as JSON text, or
          // the driver sends it as a Postgres composite and the insert fails.
          // Arrays are handled natively by `pg` and must NOT be stringified.
          return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
            ? JSON.stringify(v)
            : v;
        });
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        // eslint-disable-next-line no-await-in-loop
        await db.query(`INSERT INTO "${name}" (${quoted}) VALUES (${placeholders})`, params);
        restored[name]++;
      }
    }

    // Sequences do not move when rows are inserted with explicit ids, so
    // without this the first INSERT after a restore collides on the primary key
    // — which looks like data corruption and is merely a counter.
    await resetSequences(db, names);
  } finally {
    await db.query("SET session_replication_role = 'origin'");
  }

  return { tables: restored, rowCount: Object.values(restored).reduce((a, n) => a + n, 0) };
}

/** Move every serial sequence past the largest id now in its table. */
export async function resetSequences(db, names) {
  const { rows } = await db.query(`
    SELECT c.relname AS table_name, a.attname AS column_name,
           pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`);

  const wanted = names ? new Set(names) : null;
  let moved = 0;
  for (const r of rows) {
    if (wanted && !wanted.has(r.table_name)) continue;
    // `false` as the third argument means "the next value IS this", which is
    // what makes an empty table restart at 1 rather than 2.
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `SELECT setval($1, COALESCE((SELECT MAX("${r.column_name}") FROM "${r.table_name}"), 0) + 1, false)`,
      [r.seq]
    );
    moved++;
  }
  return moved;
}
