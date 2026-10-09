import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { dailyShare, daysBetween } from '../lib/daily-cost-math.js';

suite('daily cost math');

test('a month of daily shares adds back to the bill', () => {
  const c = { amount: 3100, frequency: 'monthly', starts_on: '2026-01-01' };
  const oct = daysBetween('2026-10-01', '2026-10-31').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(oct - 3100) < 0.001, `October summed to ${oct}`);
  const feb = daysBetween('2026-02-01', '2026-02-28').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(feb - 3100) < 0.001, `February summed to ${feb}`);
});
test('a year of annual shares adds back (leap year too)', () => {
  const c = { amount: 1200, frequency: 'annual', starts_on: '2024-01-01' };
  const y = daysBetween('2024-01-01', '2024-12-31').reduce((a, d) => a + dailyShare(c, d), 0);
  assert(Math.abs(y - 1200) < 0.001, `2024 summed to ${y}`);
});
test('nothing before it starts or after it ends; once is a single day', () => {
  const c = { amount: 100, frequency: 'daily', starts_on: '2026-10-05', ends_on: '2026-10-07' };
  equal(dailyShare(c, '2026-10-04'), 0);
  equal(dailyShare(c, '2026-10-06'), 100);
  equal(dailyShare(c, '2026-10-08'), 0);
  const o = { amount: 500, frequency: 'once', starts_on: '2026-10-05' };
  equal(dailyShare(o, '2026-10-05'), 500);
  equal(dailyShare(o, '2026-10-06'), 0);
});

suite('team clock (real SQL)');

test('clock in, double tap, clock out, snapshot rate, daily wages', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'Sam@Example.com', name: 'Sam', hourlyRate: '20' }, 'owner');
    assert((await tc.employeeByEmail('sam@example.com')).id === emp.id, 'lookup is case-insensitive');
    const a = await tc.clockIn(emp);
    const b = await tc.clockIn(emp);
    assert(!a.already && b.already && a.shift.id === b.shift.id, 'second tap must not open a second shift');
    // Back-date and close: 2 hours at the snapshotted rate.
    await db.client.query("UPDATE staff_shifts SET started_at = now() - interval '2 hours' WHERE id = $1", [a.shift.id]);
    await tc.saveEmployee({ email: 'sam@example.com', hourlyRate: '30' }, 'owner'); // a raise
    await tc.clockOut(emp);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const labour = await tc.staffLabourByDay(today, today);
    const d = [...labour.days.values()][0];
    assert(d && Math.abs(d.cost - 40) < 0.5, `expected ~$40 at the old rate, got ${d && d.cost}`);
    equal(labour.open, 0);
    const out2 = await tc.clockOut(emp);
    assert(out2.already, 'clocking out twice is a no-op');
  } finally { db.done(); }
});

test('cannot remove someone who is clocked in', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'lee@example.com', hourlyRate: 18 });
    await tc.clockIn(emp);
    let msg = '';
    try { await tc.endEmployee(emp.id); } catch (e) { msg = e.message; }
    assert(/clocked in/.test(msg), 'should refuse');
  } finally { db.done(); }
});

test('daily P&L: overhead and wages reduce net; empty day is overhead only', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const { dailyPnl } = await import('../lib/daily-pnl.js');
    // order_items.cost and the dispatch tables are added by runtime ensure*() in production, not by a migration.
    await db.client.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(12,2)');
    const { ensureJobSchema } = await import('../lib/jobs.js');
    await ensureJobSchema();
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    await db.client.query("INSERT INTO recurring_costs (name, category, amount, frequency, starts_on) VALUES ('Daily thing','Other',100,'daily',$1)", [today]);
    const emp = await tc.saveEmployee({ email: 'pat@example.com', hourlyRate: 25 });
    const s = await tc.clockIn(emp);
    await db.client.query("UPDATE staff_shifts SET started_at = now() - interval '4 hours' WHERE id = $1", [s.shift.id]);
    await tc.clockOut(emp);
    const r = await dailyPnl({ from: today, to: today });
    const row = r.rows[0];
    equal(row.overhead, 100);
    assert(Math.abs(row.staffWages - 100) < 0.5, `wages ${row.staffWages}`);
    assert(Math.abs(row.net + 200) < 0.5, `net ${row.net}`);
  } finally { db.done(); }
});

suite('team clock: RS Ops name match');

test('an RS Ops name matches one active RS Solutions employee, never two or the wrong company', async () => {
  const db = await withTestDb();
  try {
    const tc = await import('../lib/team-clock.js');
    const a = await tc.saveEmployee({ email: 'dinesh@x.ca', name: 'Dinesh', company: 'rs_solutions' }, 'o');
    await tc.saveEmployee({ email: 'bish@x.ca', name: 'Bishakha', company: 'bargain_bay' }, 'o');
    equal((await tc.employeeByRsOpsName(' dinesh ')).id, a.id);
    equal(await tc.employeeByRsOpsName('Bishakha'), null);
    await tc.saveEmployee({ email: 'dinesh2@x.ca', name: 'Dinesh', company: 'rs_solutions' }, 'o');
    equal(await tc.employeeByRsOpsName('Dinesh'), null);
  } finally { db.done(); }
});

suite('end-of-day sales (real SQL)');

test('created vs paid, pre-tax sales, unit cost only, missing cost reported', async () => {
  const db = await withTestDb();
  try {
    const q = (s, p) => db.client.query(s, p);
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text');
    await q('ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2)');
    await q('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text');
    await q("INSERT INTO products (sku, make, model, title, price, cost, active) VALUES ('A1','LG','M1','Fridge',1000,600,true)");
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const mk = async (num, status, sub, paidToday) => (await q(
      `INSERT INTO invoices (number, email, name, status, subtotal, hst, total, created_at, paid_at)
       VALUES ($1,'a@b.ca','Cust',$2,$3,$4,$5, now(), $6) RETURNING id`,
      [num, status, sub, round(sub * 0.13), round(sub * 1.13), paidToday ? new Date().toISOString() : null])).rows[0].id;
    const round = (v) => Math.round(v * 100) / 100;
    // INV-1: $1000 unit (cost 600 from products) + $100 delivery, paid today
    const a = await mk('INV-1', 'paid', 1100, true);
    await q("INSERT INTO invoice_items (invoice_id, description, sku, amount, kind) VALUES ($1,'Fridge','A1',1000,'unit'),($1,'Delivery',NULL,100,'service')", [a]);
    // INV-2: $500 typed unit with line cost 300, still open
    const b = await mk('INV-2', 'open', 500, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind, cost) VALUES ($1,'Stove',500,'unit',300)", [b]);
    // INV-3: void, must not count anywhere
    const c = await mk('INV-3', 'void', 999, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind, cost) VALUES ($1,'x',999,'unit',1)", [c]);
    // INV-4: unit with no cost anywhere
    const d = await mk('INV-4', 'open', 200, false);
    await q("INSERT INTO invoice_items (invoice_id, description, amount, kind) VALUES ($1,'Mystery',200,'unit')", [d]);
    await q("INSERT INTO invoice_payments (invoice_id, amount, method) VALUES ($1,1243,'cash'),($2,100,'etransfer')", [a, b]);

    const { daySales } = await import('../lib/day-sales.js');
    const r = await daySales(today);
    equal(r.created.count, 3);                    // void excluded
    equal(r.created.sales, 1800);                 // 1100 + 500 + 200, pre-tax
    equal(r.created.cost, 900);                   // 600 + 300 + 0 (no cost on file)
    equal(r.created.net, 900);
    equal(r.created.missingCost, 1);
    equal(r.paid.count, 1);
    equal(r.paid.sales, 1100);
    equal(r.paid.cost, 600);                      // the delivery line has no cost of goods
    equal(r.paid.net, 500);
    equal(r.cashReceived, 1343);                  // deposits count as cash, separately
  } finally { db.done(); }
});
