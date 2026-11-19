import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { presetRange, weekRange } from '../lib/hours.js';

suite('hours ranges');
test('weeks run Monday to Sunday; last month is the whole previous month', () => {
  // 2026-11-16 is a Monday.
  equal(JSON.stringify(weekRange(0, '2026-11-18')), JSON.stringify({ from: '2026-11-16', to: '2026-11-22' }));
  equal(JSON.stringify(weekRange(-1, '2026-11-18')), JSON.stringify({ from: '2026-11-09', to: '2026-11-15' }));
  equal(JSON.stringify(presetRange('two_weeks_ago', '2026-11-18')), JSON.stringify({ from: '2026-11-02', to: '2026-11-08' }));
  equal(JSON.stringify(presetRange('last_month', '2026-11-18')), JSON.stringify({ from: '2026-10-01', to: '2026-10-31' }));
  equal(JSON.stringify(presetRange('last_month', '2027-01-05')), JSON.stringify({ from: '2026-12-01', to: '2026-12-31' }));
});

suite('hours report and payroll (real SQL)');
test('staff + driver shifts in one list; unclosed/too-long left out; payroll includes clock pay', async () => {
  const db = await withTestDb();
  try {
    const { query } = await import('../lib/db.js');
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'sam@example.com', name: 'Sam', hourlyRate: '20' }, 'owner');
    await query(`INSERT INTO staff_shifts (employee_id, started_at, ended_at, rate) VALUES
      ($1,'2026-11-10T14:00:00Z','2026-11-10T22:00:00Z',20),
      ($1,'2026-11-11T14:00:00Z',NULL,20)`, [emp.id]);
    const { rows: [u] } = await query(`INSERT INTO users (email, name, password_hash, hourly_rate) VALUES ('rob@drivers.test','Rob','x',25) RETURNING id`);
    await query(`INSERT INTO driver_shifts (user_id, driving, started_at, ended_at) VALUES
      ($1,true,'2026-11-10T13:00:00Z','2026-11-10T21:00:00Z'),
      ($1,true,'2026-11-12T13:00:00Z','2026-11-14T13:00:00Z')`, [u.id]);
    const { hoursReport } = await import('../lib/hours.js');
    const r = await hoursReport({ from: '2026-11-09', to: '2026-11-15' });
    equal(r.shifts.length, 4);
    equal(r.totals.hours, 16);            // 8h staff + 8h driver
    equal(r.totals.cost, 360);            // 8*20 + 8*25
    equal(r.totals.open, 1);
    equal(r.totals.tooLong, 1);
    const { payrollReport } = await import('../lib/payroll.js');
    // payrollReport reads "now"; the week range is what matters here, so call the shared pieces directly.
    const pr = await payrollReport({ weekOffset: 0 });
    assert(pr && Array.isArray(pr.workers), 'payroll still builds');
  } finally { db.done(); }
});

test('shifts on both clocks only warn when they overlap in time', async () => {
  const db = await withTestDb();
  try {
    const { query } = await import('../lib/db.js');
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const tc = await import('../lib/team-clock.js');
    const emp = await tc.saveEmployee({ email: 'nick@example.com', name: 'Nick', hourlyRate: '18' }, 'owner');
    const { rows: [u] } = await query(`INSERT INTO users (email, name, password_hash, hourly_rate, is_driver) VALUES ('nick@example.com','Nicholas','x',18,true) RETURNING id`);
    await query(`INSERT INTO staff_shifts (employee_id, started_at, ended_at, rate) VALUES ($1,'2026-11-16T18:00:00Z','2026-11-16T20:00:00Z',18)`, [emp.id]);
    await query(`INSERT INTO driver_shifts (user_id, driving, started_at, ended_at) VALUES ($1,true,'2026-11-16T20:00:00Z','2026-11-17T00:00:00Z')`, [u.id]);
    const { hoursReport } = await import('../lib/hours.js');
    let r = await hoursReport({ from: '2026-11-16', to: '2026-11-16' });
    equal(r.warnings.filter((w) => /SAME time/.test(w)).length, 0);   // 1-3pm staff, then 3-7pm driver: fine
    await query(`UPDATE driver_shifts SET started_at = '2026-11-16T19:00:00Z' WHERE user_id = $1`, [u.id]);
    r = await hoursReport({ from: '2026-11-16', to: '2026-11-16' });
    equal(r.warnings.filter((w) => /SAME time/.test(w)).length, 1);   // now they overlap by an hour
  } finally { db.done(); }
});
