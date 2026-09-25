// lib/backup.js — dump and restore, actually performed.
//
// "We have backups" is a claim. "We restored one and the rows came back
// identical" is a fact, and the difference is the entire point of 1.6. These
// run against PGlite — Postgres compiled to WebAssembly — so the schema below
// is the REAL migrated schema and the restore is a real restore.
//
// The types that break naive dump/restore code are all exercised deliberately:
// jsonb (pod_form), text[] (jobs.services), numeric (money, which must not go
// through a float), and timestamptz.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { dump, restore, listTables, resetSequences } from '../lib/backup.js';
import { migrate } from '../lib/migrate.js';

function adapt(db) {
  return {
    query: async (sql, params) => {
      if (params && params.length) return db.query(sql, params);
      const res = await db.exec(sql);
      return Array.isArray(res) ? (res[res.length - 1] || { rows: [] }) : res;
    }
  };
}

// A migrated, empty database — the real schema, every time.
async function migrated() {
  const client = adapt(new PGlite());
  const res = await migrate({ client });
  assert(res.ok, `migration failed: ${res.error}`);
  return client;
}

// Representative rows across the awkward types.
async function seed(client) {
  await client.query(
    `INSERT INTO users (email, name, phone, password_hash) VALUES ($1,$2,$3,$4)`,
    ['owner@example.ca', 'Owner', '4374888549', 'x']
  );
  await client.query(
    `INSERT INTO orders (order_number, email, name, status, subtotal, hst, total, delivery_method)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['BB-1001', 'buyer@example.ca', 'A Buyer', 'delivered', 1061.95, 138.05, 1200.00, 'delivery']
  );
  await client.query(
    `INSERT INTO jobs (job_number, type, status, customer_name, services, notes, pay_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['RS-1001', 'delivery', 'done', 'A Buyer', ['delivery_only', 'haul_away'], 'two flights of stairs', 85.50]
  );
  await client.query(
    `UPDATE jobs SET pod_form = $1 WHERE job_number = $2`,
    [JSON.stringify({ damage: false, printedName: 'A Buyer', items: [{ sku: 'X1', ok: true }] }), 'RS-1001']
  );
}

suite('lib/backup — a restore that actually happened');

test('dump then restore into a fresh database reproduces every row', async () => {
  const source = await migrated();
  await seed(source);
  const before = await dump({ client: source });
  assert(before.rowCount >= 3, `expected seeded rows, got ${before.rowCount}`);

  const target = await migrated();
  const res = await restore(before, { client: target });
  equal(res.rowCount, before.rowCount, 'row counts must match');

  const after = await dump({ client: target });
  equal(after.rowCount, before.rowCount);
  for (const name of Object.keys(before.tables)) {
    equal(after.tables[name].length, before.tables[name].length, `${name} row count`);
  }
});

test('money survives as an exact decimal, not a float', async () => {
  // numeric comes back from the driver as a STRING to preserve precision. A
  // restore that parses it into a Number is how $1,061.95 becomes $1,061.9499.
  const source = await migrated();
  await seed(source);
  const target = await migrated();
  await restore(await dump({ client: source }), { client: target });

  const { rows } = await target.query(`SELECT subtotal, hst, total FROM orders WHERE order_number = 'BB-1001'`, []);
  equal(rows[0].subtotal, '1061.95');
  equal(rows[0].hst, '138.05');
  equal(rows[0].total, '1200.00');
});

test('jsonb and text[] come back as themselves', async () => {
  // pod_form is jsonb and holds a SIGNED form; jobs.services is a text[]. Both
  // are the shapes that naive dump code mangles.
  const source = await migrated();
  await seed(source);
  const target = await migrated();
  await restore(await dump({ client: source }), { client: target });

  const { rows } = await target.query(`SELECT services, pod_form FROM jobs WHERE job_number = 'RS-1001'`, []);
  equal(rows[0].services, ['delivery_only', 'haul_away'], 'text[] preserved');
  equal(rows[0].pod_form.printedName, 'A Buyer', 'jsonb preserved');
  equal(rows[0].pod_form.items[0].sku, 'X1', 'nested jsonb preserved');
});

test('THE SEQUENCES ARE MOVED, so the next insert does not collide', async () => {
  // The failure this prevents looks like data corruption and is merely a
  // counter: rows restore with explicit ids, the sequence still sits at 1, and
  // the first new order after a restore dies on a duplicate key.
  const source = await migrated();
  await seed(source);
  const target = await migrated();
  await restore(await dump({ client: source }), { client: target });

  const { rows } = await target.query(
    `INSERT INTO orders (order_number, email, name, status, total, delivery_method)
     VALUES ('BB-1002','b@c.ca','B','confirmed',10,'pickup') RETURNING id`, []
  );
  assert(rows[0].id > 1, `next id should be past the restored rows, got ${rows[0].id}`);
});

test('restoring into a database with no schema is refused, clearly', async () => {
  // A restore that also built the schema could rebuild it WRONG — from whatever
  // the dump happened to capture rather than from the migrations, which are the
  // definition. So it refuses and says what to do.
  const source = await migrated();
  await seed(source);
  const empty = adapt(new PGlite());
  let err = null;
  try { await restore(await dump({ client: source }), { client: empty }); }
  catch (e) { err = e; }
  assert(err, 'should have refused');
  assert(/missing/i.test(err.message), `unhelpful: ${err.message}`);
  assert(/migrations first/i.test(err.message), 'says what to do about it');
});

test('restoring into a POPULATED database collides rather than silently merging', async () => {
  // truncate is off by default, because emptying a database is not something to
  // do by omission. The consequence is that restoring a snapshot into a
  // database that already holds rows hits a primary-key collision — restored
  // ids are explicit and both databases start their sequences at 1.
  //
  // That is the SAFE outcome and is pinned here deliberately: the alternative
  // would be silently interleaving two datasets, which nobody could unpick.
  // Use { truncate: true } when you mean to replace.
  const source = await migrated();
  await seed(source);
  const snapshot = await dump({ client: source });

  const target = await migrated();
  await target.query(
    `INSERT INTO orders (order_number, email, name, status, total, delivery_method)
     VALUES ('BB-9999','z@z.ca','Z','confirmed',5,'pickup')`, []
  );

  let err = null;
  try { await restore(snapshot, { client: target }); } catch (e) { err = e; }
  assert(err, 'should have collided rather than merged');
  assert(/duplicate key/i.test(err.message), `expected a key collision, got: ${err.message}`);
});

test('the migration ledger is NOT part of the data', async () => {
  // schema_migrations describes the TARGET's schema history. Restoring the
  // source's copy over it would replace the target's record of what has been
  // applied to it with somebody else's.
  const source = await migrated();
  const d = await dump({ client: source });
  assert(!('schema_migrations' in d.tables), 'schema_migrations must not be dumped');

  const { rows } = await source.query('SELECT count(*)::int AS n FROM schema_migrations', []);
  assert(rows[0].n > 0, 'but it is certainly there in the database');
});

test('with truncate, the target ends up matching the dump exactly', async () => {
  const source = await migrated();
  await seed(source);
  const snapshot = await dump({ client: source });

  const target = await migrated();
  await target.query(
    `INSERT INTO orders (order_number, email, name, status, total, delivery_method)
     VALUES ('BB-9999','z@z.ca','Z','confirmed',5,'pickup')`, []
  );
  await restore(snapshot, { client: target, truncate: true });
  const { rows } = await target.query('SELECT order_number FROM orders ORDER BY order_number', []);
  equal(rows.map((r) => r.order_number), ['BB-1001'], 'only what the dump held');
});

suite('lib/backup — the shape of a dump');

test('a dump names every application table, including the empty ones', async () => {
  // An empty table in the dump is information: it says the table existed and
  // held nothing, which is different from it being missing.
  const source = await migrated();
  const d = await dump({ client: source });
  const tables = await listTables(source);
  equal(Object.keys(d.tables).length, tables.length);
  assert(tables.includes('orders') && tables.includes('jobs') && tables.includes('invoices'));
  equal(d.rowCount, 0, 'a fresh database dumps zero rows, not an error');
});

test('a dump carries when it was taken', async () => {
  const d = await dump({ client: await migrated() });
  assert(!Number.isNaN(Date.parse(d.takenAt)), 'takenAt must be a real timestamp');
  equal(d.format, 1, 'the format is versioned, so a future reader can tell');
});

test('nonsense is refused rather than half-restored', async () => {
  const target = await migrated();
  for (const bad of [null, {}, { notTables: 1 }]) {
    let err = null;
    try { await restore(bad, { client: target }); } catch (e) { err = e; }
    assert(err, `should have refused ${JSON.stringify(bad)}`);
  }
});

test('resetSequences is safe to run on its own', async () => {
  const client = await migrated();
  const moved = await resetSequences(client, null);
  assert(moved > 10, `expected many serial sequences, moved ${moved}`);
});
