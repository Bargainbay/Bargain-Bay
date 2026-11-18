// One Payroll page: a week of clocked hours per person, and posting it to what they are owed exactly once.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { mondayOf, weekBounds, summarizeShifts, payrollWeek, postWeekOwed, syncOwedFromClock } from '../lib/payroll-week.js';
import { payBalances, addPayment } from '../lib/pay-ledger.js';

const emp = async (name, rate, email = `${name.toLowerCase()}@x.ca`) =>
  (await query(`INSERT INTO employees (email, name, hourly_rate) VALUES ($1,$2,$3) RETURNING id`, [email, name, rate])).rows[0].id;
const shift = (id, day, start, end, rate) => query(
  `INSERT INTO staff_shifts (employee_id, started_at, ended_at, rate)
   VALUES ($1, ($2::date + $3::time) AT TIME ZONE 'America/Toronto', ($2::date + $4::time) AT TIME ZONE 'America/Toronto', $5)`, [id, day, start, end, rate]);

suite('payroll week');

test('WEEKS RUN MONDAY TO SUNDAY, ON THE CALENDAR', () => {
  equal(mondayOf('2026-11-08'), '2026-11-02'); // a Sunday
  equal(mondayOf('2026-11-02'), '2026-11-02');
  equal(mondayOf('2026-10-21'), '2026-10-19');
  const w = weekBounds('2026-10-21');
  equal(w.start, '2026-10-19'); equal(w.end, '2026-10-25'); equal(w.prev, '2026-10-12'); equal(w.next, '2026-10-26');
});

test('summarizeShifts: HOURS X THE RATE EACH SHIFT CARRIED, AND WHAT IT COULD NOT COUNT IS SAID', () => {
  const t = (h) => new Date(Date.UTC(2026, 9, 19, 14, 0) + h * 3600000).toISOString();
  const s = summarizeShifts([
    { name: 'Guri', started_at: t(0), ended_at: t(8), rate: 18 },
    { name: 'guri', started_at: t(24), ended_at: t(33.5), rate: 18 },
    { name: 'Nick', started_at: t(0), ended_at: t(19.4), rate: 18 },
    { name: 'Nick', started_at: t(30), ended_at: null, rate: 18 },
    { name: 'New', started_at: t(0), ended_at: t(2), rate: null }
  ]);
  const g = s.find((x) => x.name === 'Guri');
  equal(g.hours, 17.5); equal(g.earned, 315); equal(g.shifts, 2);
  const n = s.find((x) => x.name === 'Nick');
  equal(n.hours, 0); equal(n.tooLong, 1); equal(n.open, 1);
  equal(s.find((x) => x.name === 'New').noRate, 1);
});

test('A SHIFT OVER 14 HOURS COUNTS ONCE THE OFFICE HAS CONFIRMED IT, BUT NEVER PAST 20', () => {
  const t = (h) => new Date(Date.UTC(2026, 10, 17, 12, 57) + h * 3600000).toISOString();
  const s = summarizeShifts([
    { name: 'Taj', started_at: t(0), ended_at: t(14.14), rate: 20, reviewed: true },
    { name: 'Taj', started_at: t(30), ended_at: t(44.14), rate: 20 },
    { name: 'Taj', started_at: t(60), ended_at: t(81), rate: 20, reviewed: true }
  ]);
  equal(s[0].shifts, 1); equal(s[0].hours, 14.14); equal(s[0].earned, 282.8); equal(s[0].tooLong, 2);
});

test('GURI\'S OCT 19-23 WEEK COMES TO 35.5 HOURS; POSTING IT TWICE UPDATES, NEVER DOUBLES, AND A PAYMENT TAKES IT DOWN', async () => {
  const { done } = await withTestDb();
  try {
    const g = await emp('Guri', 18);
    await shift(g, '2026-10-19', '10:00', '18:00', 18);
    await shift(g, '2026-10-21', '10:00', '20:00', 18);
    await shift(g, '2026-10-22', '10:00', '19:30', 18);
    await shift(g, '2026-10-23', '10:00', '18:00', 18);
    const w = await payrollWeek('2026-10-21');
    equal(w.week.start, '2026-10-19');
    const p = w.people.find((x) => x.name === 'Guri');
    equal(p.hours, 35.5); equal(p.total, 639); assert(p.posted === null);

    await postWeekOwed({ person: 'Guri', weekStart: '2026-10-19', by: 'a' });
    equal((await payrollWeek('2026-10-19')).people[0].posted, 639);
    await shift(g, '2026-10-24', '10:00', '12:00', 18); // a late-added shift
    assert((await payrollWeek('2026-10-19')).people[0].stale, 'the posted figure is flagged as out of date');
    await postWeekOwed({ person: 'guri', weekStart: '2026-10-19', by: 'a' });
    const owed = (await query(`SELECT * FROM pay_ledger WHERE kind = 'owed'`)).rows;
    equal(owed.length, 1, 'one line per person and week'); equal(Number(owed[0].amount), 675);

    await addPayment({ person: 'Guri', amount: 568, date: '2026-11-08', how: 'bank', periodStart: '2026-10-19', periodEnd: '2026-10-23', by: 'a' });
    const bal = (await payBalances()).people.find((x) => x.person === 'Guri');
    equal(bal.owed, 675); equal(bal.paid, 568); equal(bal.balance, 107);
  } finally { done(); }
});

test('A PERSON STILL CLOCKED IN CANNOT BE POSTED, AND NOBODY WITH NOTHING EARNED CAN', async () => {
  const { done } = await withTestDb();
  try {
    const n = await emp('Nick', 18);
    await query(`INSERT INTO staff_shifts (employee_id, started_at, rate) VALUES ($1, ('2026-10-27'::date + '10:00'::time) AT TIME ZONE 'America/Toronto', 18)`, [n]);
    await shift(n, '2026-10-26', '10:00', '12:00', 18);
    let msg = ''; try { await postWeekOwed({ person: 'Nick', weekStart: '2026-10-26' }); } catch (e) { msg = e.message; }
    assert(/still clocked in/.test(msg), msg);
    let m2 = ''; try { await postWeekOwed({ person: 'Nobody', weekStart: '2026-10-26' }); } catch (e) { m2 = e.message; }
    assert(/nothing earned/.test(m2), m2);
  } finally { done(); }
});

test('TWO EMPLOYEE ROWS FOR ONE NAME ARE ONE PERSON ON THE PAGE', async () => {
  const { done } = await withTestDb();
  try {
    const a = await emp('Roushi', 20, 'a@x.ca'); const b = await emp('Roushi', 20, 'b@x.ca');
    await shift(a, '2026-11-02', '10:00', '14:00', 20); await shift(b, '2026-11-03', '10:00', '12:00', 20);
    const w = await payrollWeek('2026-11-02');
    equal(w.people.length, 1); equal(w.people[0].hours, 6); equal(w.people[0].total, 120);
  } finally { done(); }
});

test('A RATE ENTERED WRONG CAN BE CORRECTED FOR SHIFTS SINCE A DAY; THE USUAL CHANGE LEAVES THE PAST ALONE', async () => {
  const { done } = await withTestDb();
  try {
    const { saveEmployee } = await import('../lib/team-clock.js');
    const g = await emp('Guri', 18, 'g@x.ca');
    await shift(g, '2026-10-19', '10:00', '18:00', 18); await shift(g, '2026-10-12', '10:00', '18:00', 18);
    const plain = await saveEmployee({ email: 'g@x.ca', name: 'Guri', hourlyRate: 16 }, 'a');
    equal(plain.repriced, 0);
    equal((await payrollWeek('2026-10-19')).people[0].total, 144, 'the usual change does not touch past shifts');
    const fixed = await saveEmployee({ email: 'g@x.ca', name: 'Guri', hourlyRate: 16, backfillFrom: '2026-10-19' }, 'a');
    equal(fixed.repriced, 1);
    equal((await payrollWeek('2026-10-19')).people[0].total, 128, '8 h at the corrected $16');
    equal((await payrollWeek('2026-10-12')).people[0].total, 144, 'a week before the date is left as it was');
  } finally { done(); }
});

test('A PAYMENT DATED BEFORE A TILL COUNT BUT TYPED IN AFTER IT IS NOT TAKEN OFF THE TILL AGAIN', async () => {
  const { done } = await withTestDb();
  try {
    const { addEntry, bankrollSummary } = await import('../lib/bankroll.js');
    const { addPayment } = await import('../lib/pay-ledger.js');
    await addEntry({ date: '2026-11-08', kind: 'count', amount: 0, by: 'a' }); // counted last night: nothing in the till
    await new Promise((r) => setTimeout(r, 25));
    await addPayment({ person: 'Roushi', amount: 580, date: '2026-11-07', how: 'cash', by: 'a' }); // happened the day before the count
    await addEntry({ date: '2026-11-07', kind: 'cash', amount: -100, note: 'earlier', by: 'a' });
    equal((await bankrollSummary('2026-11-09')).cash, 0, 'both happened before the count, so the count already has them');
    await addPayment({ person: 'Roushi', amount: 50, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), how: 'cash', by: 'a' });
    equal((await bankrollSummary('2026-11-09')).cash, -50, 'one dated today still comes off');
  } finally { done(); }
});

test('THE CLOCK POSTS TO OWED BY ITSELF, TWICE IS THE SAME, AND A WEEK THE OFFICE TYPED IS NEVER DOUBLED', async () => {
  const { done } = await withTestDb();
  try {
    const r = await emp('Roushi', 20);
    await shift(r, '2026-10-20', '10:00', '20:00', 20);   // Oct 19 week: owed already typed by hand
    await shift(r, '2026-10-27', '10:00', '20:00', 20);   // Oct 26 week: the clock should post it
    await query(`INSERT INTO pay_ledger (person, kind, amount, period_start, period_end, source) VALUES ('Roushi','owed',1080,'2026-10-19','2026-10-25','manual')`);
    const a = await syncOwedFromClock('t');
    const again = await syncOwedFromClock('t');
    equal(a.find((x) => x.name === 'Roushi').hours, 20, 'both weeks counted in hours');
    equal(again.find((x) => x.name === 'Roushi').hours, 20);
    const owed = (await query(`SELECT amount, source FROM pay_ledger WHERE kind = 'owed' ORDER BY period_start`)).rows;
    equal(owed.length, 2, 'the typed week is left alone, the other posted once');
    equal(Number(owed[1].amount), 200); equal(owed[1].source, 'hours');
  } finally { await done(); }
});

test('DRIVERS ARE PAID BY THE HOUR: THEIR DRIVER-APP SHIFTS COUNT, AN OWNER AND A DOUBLE CLOCK DO NOT', async () => {
  const db = await withTestDb();
  try {
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const usr = async (name, email, rate, owner = false) => (await query(
      `INSERT INTO users (email, name, password_hash, hourly_rate, paid_as_owner) VALUES ($1,$2,'x',$3,$4) RETURNING id`, [email, name, rate, owner])).rows[0].id;
    const ds = (uid, day, a, b) => query(
      `INSERT INTO driver_shifts (user_id, driving, started_at, ended_at)
       VALUES ($1, true, ($2::date + $3::time) AT TIME ZONE 'America/Toronto', ($2::date + $4::time) AT TIME ZONE 'America/Toronto')`, [uid, day, a, b]);
    const rob = await usr('Rob', 'rob@d.test', 22);
    const boss = await usr('Boss', 'boss@d.test', 50, true);
    await ds(rob, '2026-11-10', '08:00', '16:00');      // 8h x $22 = $176
    await ds(boss, '2026-11-10', '08:00', '16:00');     // owner: not payroll
    // Sam is on BOTH clocks for the same stretch: paid once, off the /clock shift.
    const sam = await usr('Sam', 'sam@x.ca', 30);
    const samEmp = await emp('Sam', 25, 'sam@x.ca');
    await shift(samEmp, '2026-11-10', '09:00', '17:00', 25);
    await ds(sam, '2026-11-10', '09:00', '17:00');
    const wk = await payrollWeek('2026-11-09');
    const by = (n) => wk.people.find((p) => p.name === n);
    equal(by('Rob').hours, 8); equal(by('Rob').earned, 176);
    assert(!by('Boss'), 'an owner paid as owner is not on payroll');
    equal(by('Sam').hours, 8); equal(by('Sam').earned, 200);
  } finally { db.done(); }
});

test('ONE ACCOUNT ON BOTH CLOCKS IS ONE PERSON, UNDER THE EMPLOYEE\'S NAME', async () => {
  const db = await withTestDb();
  try {
    const { ensureShiftSchema } = await import('../lib/shifts.js');
    await ensureShiftSchema();
    const uid = (await query(`INSERT INTO users (email, name, password_hash, hourly_rate) VALUES ('nick@x.ca','Nicholas Carter','x',20) RETURNING id`)).rows[0].id;
    const eid = await emp('Nick', 18, 'nick@x.ca');
    await shift(eid, '2026-11-10', '09:00', '13:00', 18);   // 4h x 18 = 72
    await query(`INSERT INTO driver_shifts (user_id, driving, started_at, ended_at)
      VALUES ($1, true, ('2026-11-11'::date + '09:00'::time) AT TIME ZONE 'America/Toronto', ('2026-11-11'::date + '17:00'::time) AT TIME ZONE 'America/Toronto')`, [uid]); // 8h x 20 = 160
    const wk = await payrollWeek('2026-11-09');
    equal(wk.people.filter((p) => /nick/i.test(p.name)).length, 1);
    const n = wk.people.find((p) => p.name === 'Nick');
    equal(n.hours, 12); equal(n.earned, 232);
    // A line the clock posted earlier under the old driver name is taken off by the next sync, not left to owe it twice.
    await query(`INSERT INTO pay_ledger (person, kind, amount, period_start, period_end, note, source) VALUES ('Nicholas Carter','owed',160,'2026-11-09','2026-11-15','old','hours')`);
    await syncOwedFromClock('test');
    const owed = (await query(`SELECT lower(person) AS p FROM pay_ledger WHERE kind='owed' AND source='hours' AND voided_at IS NULL AND period_start='2026-11-09'`)).rows.map((r) => r.p);
    assert(!owed.includes('nicholas carter'), 'the old line under the driver name is voided');
  } finally { db.done(); }
});
