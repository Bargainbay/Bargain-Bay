// lib/audit.js — the change log.
import { PGlite } from '@electric-sql/pglite';
import { suite, test, assert, equal } from './_harness.mjs';
import { audit, listAudit } from '../lib/audit.js';
import { __useTestDatabase } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

async function fresh() {
  const db = new PGlite();
  const client = { query: async (sql, p) => (p && p.length ? db.query(sql, p) : (async () => { const r = await db.exec(sql); return Array.isArray(r) ? r[r.length - 1] || { rows: [] } : r; })()) };
  const m = await migrate({ client }); assert(m.ok, m.error);
  __useTestDatabase(client);
  return client;
}

suite('audit log');

test('an entry records who, what and on which record, from the session', async () => {
  try {
    const client = await fresh();
    assert(await audit({ email: 'Rep@Example.test', name: 'Rep' }, { action: 'invoice.void', entity: 'invoice', entityId: 'INV-1', summary: 'Invoice voided' }));
    const { rows } = await client.query('SELECT * FROM audit_log');
    equal(rows.length, 1); equal(rows[0].actor, 'rep@example.test'); equal(rows[0].entity_id, 'INV-1'); equal(rows[0].actor_name, 'Rep');
  } finally { __useTestDatabase(null); }
});

test('no session is logged as unknown, not dropped', async () => {
  try {
    const client = await fresh();
    await audit(null, { action: 'coupon.delete', entity: 'coupon', entityId: 5 });
    equal((await client.query('SELECT actor FROM audit_log')).rows[0].actor, 'unknown');
  } finally { __useTestDatabase(null); }
});

test('detail is stored as json and long summaries are cut', async () => {
  try {
    const client = await fresh();
    await audit({ email: 'a@b.test' }, { action: 'x', entity: 'invoice', summary: 'z'.repeat(900), detail: { total: 12.5 } });
    const r = (await client.query('SELECT summary, detail FROM audit_log')).rows[0];
    equal(r.summary.length, 500); equal(r.detail.total, 12.5);
  } finally { __useTestDatabase(null); }
});

test('listing filters by entity, actor and text, newest first', async () => {
  try {
    await fresh();
    await audit({ email: 'a@x.test' }, { action: 'invoice.void', entity: 'invoice', entityId: 'INV-7' });
    await audit({ email: 'b@x.test' }, { action: 'clearance.set', entity: 'clearance', entityId: 'SKU-9', summary: 'Clearance price $400.00' });
    const all = await listAudit();
    equal(all.total, 2); equal(all.rows[0].entity_id, 'SKU-9');
    equal((await listAudit({ entity: 'invoice' })).rows.length, 1);
    equal((await listAudit({ actor: 'B@x.test' })).rows[0].entity, 'clearance');
    equal((await listAudit({ q: 'INV-7' })).rows.length, 1);
  } finally { __useTestDatabase(null); }
});

test('a failing write never throws into the action it describes', async () => {
  try {
    __useTestDatabase({ query: async () => { throw new Error('db down'); } });
    equal(await audit({ email: 'a@x.test' }, { action: 'x', entity: 'invoice' }), false);
  } finally { __useTestDatabase(null); }
});
