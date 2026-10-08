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
