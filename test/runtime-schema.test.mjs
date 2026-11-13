// A database built from the migrations ALONE must be complete.
//
// 30 files in lib/ used to create their own tables at runtime (ensureXSchema), so a
// database built from db/migrations was missing 22 of them: staging, a restore target
// or a new client would have booted into a different shape from production and failed
// on first use. 0023_runtime_schema.sql carries them. This test is what stops the next
// ensureXSchema() quietly reopening the gap: it builds the schema from the migrations,
// then fails on any table the code reads or writes that is not in it.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, equal } from './_harness.mjs';
import { migrate } from '../lib/migrate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adapt = (db) => ({ query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) });

// Words that follow FROM/JOIN/INTO/UPDATE in SQL but are not our tables.
const NOT_TABLES = new Set([
  'select', 'lateral', 'only', 'values', 'unnest', 'generate_series', 'jsonb_array_elements', 'jsonb_each', 'jsonb_to_recordset',
  'json_array_elements', 'json_each', 'regexp_split_to_table', 'string_to_table', 'dual', 'the', 'a', 'an', 'this', 'that', 'it',
  'each', 'one', 'both', 'now', 'set', 'stdin', 'rows', 'row', 'users_view',
  // Looked at and confirmed NOT tables: Postgres catalogs; `EXTRACT(QUARTER FROM d)` (lib/analytics);
  // an English sentence ("Created from invoice", lib/invoices); `of` in prose (lib/vendor-orders);
  // and CTEs built by a helper that the regex cannot see being defined (`latest`, `here` in lib/locations).
  'pg_class', 'pg_namespace', 'pg_attribute', 'd', 'invoice', 'of', 'latest', 'here'
]);

function sourceFiles() {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === '.next') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|mjs)$/.test(n)) out.push(p);
  } };
  walk(join(root, 'lib')); walk(join(root, 'app'));
  return out;
}

// Names the code uses as tables: identifiers after FROM/JOIN/INTO/UPDATE inside a string that is
// plainly SQL. CTE names are excluded by collecting `WITH x AS (` and `, y AS (`.
export function tablesReferenced(src) {
  const found = new Map();
  const lits = src.match(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || [];
  for (const lit of lits) {
    if (!/\b(select|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(lit)) continue;
    const text = lit.replace(/--[^\n]*/g, ' ');
    const ctes = new Set([...text.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s*([a-z_][a-z0-9_]*)\s+as\s*(?:materialized\s*)?\(/gi)].map((m) => m[1].toLowerCase()));
    const aliases = new Set([...text.matchAll(/\)\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
    for (const m of text.matchAll(/\b(?:from|join|into|update)\s+(?:only\s+)?("?)([a-z_][a-z0-9_]*)\1(?![a-z0-9_.(])/gi)) {
      const t = m[2].toLowerCase();
      if (NOT_TABLES.has(t) || ctes.has(t) || aliases.has(t)) continue;
      // `FROM` in prose, e.g. "Pulled from the tracker": require the literal to look like SQL around it.
      if (!/\b(select|set|values|where|returning|on\s+conflict|order\s+by|group\s+by)\b/i.test(text) && !/\bupdate\s+\w+\s+set\b/i.test(text)) continue;
      found.set(t, (found.get(t) || 0) + 1);
    }
  }
  return found;
}

suite('a database built from the migrations alone is complete');

let tables = null;
async function builtTables() {
  if (tables) return tables;
  const db = new PGlite(); const client = adapt(db);
  const m = await migrate({ client }); assert(m.ok, m.error);
  tables = new Set((await db.query(`select table_name from information_schema.tables where table_schema in ('public') union select table_name from information_schema.views where table_schema='public'`)).rows.map((r) => r.table_name));
  return tables;
}

test('the runtime-schema migration is idempotent: running its SQL again changes nothing and errors nowhere', async () => {
  const db = new PGlite(); const client = adapt(db);
  const m = await migrate({ client }); assert(m.ok, m.error);
  const sql = readFileSync(join(root, 'db', 'migrations', '0023_runtime_schema.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
});

test('every table the code reads or writes exists after the migrations', async () => {
  const have = await builtTables();
  const missing = new Map();
  for (const f of sourceFiles()) {
    for (const [t, n] of tablesReferenced(readFileSync(f, 'utf8'))) {
      if (have.has(t)) continue;
      const rel = f.replace(root + '/', '');
      missing.set(t, [...(missing.get(t) || []), rel]);
    }
  }
  const lines = [...missing].map(([t, fs]) => `${t}  (${[...new Set(fs)].slice(0, 3).join(', ')})`);
  assert(!lines.length, `${lines.length} table(s) used by the code but created by no migration:\n  ${lines.join('\n  ')}`);
});
