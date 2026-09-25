// A real Postgres for the tests that need one, and the plumbing to point the
// app's own lib/db at it.
//
// PGlite is Postgres compiled to WebAssembly. The modules under test are the
// REAL ones — lib/customers, lib/invoices — running their real SQL; only the
// connection underneath is swapped.
import { PGlite } from '@electric-sql/pglite';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

// `pg` takes a multi-statement string on the simple protocol; PGlite's .query()
// is the extended protocol and takes one statement. Route by whether the caller
// passed parameters, which is exactly the distinction that matters in practice.
function adapt(db) {
  return {
    query: async (sql, params) => {
      if (params && params.length) return db.query(sql, params);
      const res = await db.exec(sql);
      return Array.isArray(res) ? (res[res.length - 1] || { rows: [] }) : res;
    },
    // lib/db's withTransaction takes this path only when NOT under test, but a
    // caller that reaches for it should get something sane rather than undefined.
    connect: async () => adapt(db),
    release: () => {}
  };
}

/**
 * A migrated, empty database, installed as the app's database for the duration.
 * Returns the client plus a `done()` that puts the real pool back — call it, or
 * the next test file inherits this database.
 */
export async function withTestDb() {
  const client = adapt(new PGlite());
  const res = await migrate({ client });
  if (!res.ok) throw new Error(`test database migration failed: ${res.error}`);
  __useTestDatabase(client);
  return { client, done: () => __useTestDatabase(null) };
}
