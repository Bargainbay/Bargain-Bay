// lib/migrate.js — schema migrations, run against a real Postgres.
//
// PGlite is Postgres compiled to WebAssembly, so these are not tests against a
// stub: the baseline actually runs, tables actually appear, a failing migration
// actually rolls back. It boots in about half a second and applies the real
// 1,052-line baseline in about fifty milliseconds.
//
// This is the first DB-backed test in the repo. The money tests before it are
// pure arithmetic; refunds and invoices are the next thing that needs this.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { migrate, migrationStatus, listMigrations, MIGRATIONS_DIR } from '../lib/migrate.js';

// `pg` takes a multi-statement string on the simple protocol; PGlite's .query()
// is the extended protocol and takes one statement. Route by whether the caller
// passed parameters, which is exactly the distinction that matters.
function adapt(db) {
  return {
    query: async (sql, params) => {
      if (params && params.length) return db.query(sql, params);
      const res = await db.exec(sql);
      return Array.isArray(res) ? (res[res.length - 1] || { rows: [] }) : res;
    }
  };
}

const fresh = async () => adapt(new PGlite());

function tmpMigrations(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-migrations-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

suite('lib/migrate — the real baseline');

test('the baseline applies cleanly and builds the whole schema', async () => {
  const client = await fresh();
  const res = await migrate({ client });
  assert(res.ok, `baseline failed: ${res.error}`);
  equal(res.applied.map((a) => a.id), ['0001_baseline'], 'applied exactly the baseline');

  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"
  );
  assert(rows[0].n > 40, `expected the full schema, got ${rows[0].n} tables`);
});

test('running it twice applies nothing the second time', async () => {
  // The button on /admin is pressed by people who are not sure whether they
  // pressed it already.
  const client = await fresh();
  await migrate({ client });
  const again = await migrate({ client });
  assert(again.ok);
  equal(again.applied, [], 'nothing re-applied');
  equal(again.skipped, ['0001_baseline'], 'recorded as already applied');
});

test('the ledger records what ran, and when', async () => {
  const client = await fresh();
  await migrate({ client });
  const { rows } = await client.query('SELECT id, checksum, ms FROM schema_migrations');
  equal(rows.length, 1);
  equal(rows[0].id, '0001_baseline');
  assert(rows[0].checksum && rows[0].checksum.length === 16, 'checksum recorded');
  assert(rows[0].ms >= 0, 'duration recorded');
});

suite('lib/migrate — ordering, failure and history');

test('migrations apply in filename order', async () => {
  const dir = tmpMigrations({
    '0002_second.sql': 'CREATE TABLE b (id int);',
    '0001_first.sql': 'CREATE TABLE a (id int);',
    '0010_tenth.sql': 'CREATE TABLE c (id int);'
  });
  const client = await fresh();
  const res = await migrate({ client, dir });
  assert(res.ok, res.error);
  equal(res.applied.map((a) => a.id), ['0001_first', '0002_second', '0010_tenth'],
    'zero-padding is what keeps 0010 after 0002');
});

test('A FAILING MIGRATION ROLLS BACK AND STOPS THE RUN', async () => {
  // The whole reason this is worth having over a re-run blob: Postgres has
  // transactional DDL, so a migration that dies halfway leaves nothing behind.
  const dir = tmpMigrations({
    '0001_ok.sql': 'CREATE TABLE good (id int);',
    '0002_broken.sql': 'CREATE TABLE half (id int); SELECT this_function_does_not_exist();',
    '0003_never.sql': 'CREATE TABLE later (id int);'
  });
  const client = await fresh();
  const res = await migrate({ client, dir });

  assert(!res.ok, 'should have failed');
  equal(res.failed, '0002_broken');
  assert(res.rolledBack, 'reported as rolled back');
  equal(res.applied.map((a) => a.id), ['0001_ok'], 'the good one before it stands');

  // The half-built table from the failed migration must not exist.
  const { rows } = await client.query(
    "SELECT to_regclass('public.half') AS half, to_regclass('public.good') AS good, to_regclass('public.later') AS later"
  );
  equal(rows[0].half, null, 'the failed migration left nothing behind');
  assert(rows[0].good, 'the one before it survived');
  equal(rows[0].later, null, 'later migrations did NOT run — they may assume 0002 did');
});

test('a re-run after a failure picks up where it stopped', async () => {
  const dir = tmpMigrations({
    '0001_ok.sql': 'CREATE TABLE good (id int);',
    '0002_broken.sql': 'SELECT this_function_does_not_exist();'
  });
  const client = await fresh();
  await migrate({ client, dir });
  // Fix it, the way a person would.
  fs.writeFileSync(path.join(dir, '0002_broken.sql'), 'CREATE TABLE fixed (id int);');
  const res = await migrate({ client, dir });
  assert(res.ok, res.error);
  equal(res.applied.map((a) => a.id), ['0002_broken'], 'only the previously-failed one ran');
  equal(res.skipped, ['0001_ok']);
});

test('EDITING AN APPLIED MIGRATION IS REFUSED', async () => {
  // An applied migration is history. If the file no longer describes what is in
  // the database, every later reading of it is wrong — so this is an error, not
  // a warning.
  const dir = tmpMigrations({ '0001_a.sql': 'CREATE TABLE a (id int);' });
  const client = await fresh();
  assert((await migrate({ client, dir })).ok);

  fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE a (id int, extra text);');
  const res = await migrate({ client, dir });
  assert(!res.ok, 'should refuse');
  assert(/has changed since it was applied/.test(res.error), `unhelpful message: ${res.error}`);
  assert(/Add a new one/.test(res.error), 'says what to do instead');
});

test('a dry run changes nothing', async () => {
  const dir = tmpMigrations({ '0001_a.sql': 'CREATE TABLE a (id int);' });
  const client = await fresh();
  const res = await migrate({ client, dir, dryRun: true });
  assert(res.ok);
  equal(res.applied.map((a) => a.id), ['0001_a'], 'reports what would run');
  const { rows } = await client.query("SELECT to_regclass('public.a') AS a");
  equal(rows[0].a, null, 'but did not create it');
});

suite('lib/migrate — status');

test('status reports applied, pending and orphans without changing anything', async () => {
  const dir = tmpMigrations({
    '0001_a.sql': 'CREATE TABLE a (id int);',
    '0002_b.sql': 'CREATE TABLE b (id int);'
  });
  const client = await fresh();
  await migrate({ client, dir });

  // A migration recorded in the database with no file here — somebody deleted
  // one, or this deployment is older than the database it is pointed at.
  await client.query("INSERT INTO schema_migrations (id, checksum) VALUES ('0009_gone','abc')", []);

  const s = await migrationStatus({ client, dir });
  assert(s.ok, s.error);
  equal(s.pending, [], 'nothing outstanding');
  equal(s.orphans, ['0009_gone'], 'the orphan is named');
  equal(s.migrations.filter((m) => m.applied).map((m) => m.id), ['0001_a', '0002_b']);
});

test('status flags a file that changed after it was applied', async () => {
  const dir = tmpMigrations({ '0001_a.sql': 'CREATE TABLE a (id int);' });
  const client = await fresh();
  await migrate({ client, dir });
  fs.writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE a (id int, b text);');
  const s = await migrationStatus({ client, dir });
  assert(s.migrations[0].changedSinceApplied, 'should be flagged before anybody tries to run it');
});

suite('lib/migrate — reading the directory');

test('the real migrations directory is found and parsed', () => {
  const found = listMigrations();
  assert(found.length >= 1, `no migrations found in ${MIGRATIONS_DIR}`);
  equal(found[0].id, '0001_baseline');
  assert(found[0].inTransaction, 'the baseline runs in a transaction');
  assert(found[0].checksum.length === 16);
});

test('a migration can opt out of its transaction', () => {
  // CREATE INDEX CONCURRENTLY does not block writes, which matters on a live
  // table, and Postgres refuses it inside a transaction.
  const dir = tmpMigrations({
    '0001_conc.sql': '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY x ON y (z);'
  });
  const [m] = listMigrations(dir);
  assert(!m.inTransaction, 'the marker was not honoured');
});

test('a missing directory is an empty list, not a crash', () => {
  equal(listMigrations('/definitely/not/a/directory'), []);
});

test('with no database and no client, it says so rather than throwing', async () => {
  const saved = process.env.POSTGRES_URL;
  delete process.env.POSTGRES_URL;
  try {
    const res = await migrate();
    equal(res.ok, false);
    assert(/POSTGRES_URL/.test(res.error));
  } finally { if (saved) process.env.POSTGRES_URL = saved; }
});
