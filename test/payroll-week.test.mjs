// One Payroll page: a week of clocked hours per person, and posting it to what they are owed exactly once.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { mondayOf, weekBounds, summarizeShifts, payrollWeek, postWeekOwed } from '../lib/payroll-week.js';
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
