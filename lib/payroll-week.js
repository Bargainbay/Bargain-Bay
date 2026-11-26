// One week of pay, per person: the hours they clocked, what that comes to, and whether it has been posted to what
// they are owed. Weeks run Monday to Sunday in Toronto time.
//
// Earned = hours x the rate each shift carried when it started (a rate change never rewrites past shifts), plus any
// piece-rate or delivery pay from the older labour log. Posting a week writes ONE "owed" line for that person and week
// (source 'hours'); posting again updates it rather than adding a second, so a late-added shift just changes the number.
import { query, hasDb } from './db';
import { torontoToday } from './constants';
import { payrollReport } from './payroll';
import { roundQuarterMs } from './hours';
import { ensurePayLedgerSchema } from './pay-ledger';

const c2 = (v) => Math.round(Number(v) * 100) / 100;
const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// SQL twin of roundQuarterMs.
const QUARTER = (col) => `ROUND(EXTRACT(EPOCH FROM ${col}) / 900)`;
// A shift longer than this is almost always a forgotten clock-out (Nick's 19h22m on Nov 5). It is NOT paid until somebody
// fixes it, because paying a guess is how a week comes out wrong. Longer than the clock itself allows is refused at entry.
export const REVIEW_HOURS = 14;
// ...unless the office has already looked at it: a shift whose times were set or confirmed by a person (edited_at on
// a driver shift) is paid up to the clock's own ceiling. A 14h08m day that the owner confirmed is real work.
const CONFIRMED_MAX_HOURS = 20;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// The Monday on or before a date (YYYY-MM-DD), computed on the calendar, not on a clock.
export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export function weekBounds(weekStart) {
  const start = mondayOf(DAY.test(String(weekStart || '')) ? weekStart : torontoToday());
  return { start, end: addDays(start, 6), prev: addDays(start, -7), next: addDays(start, 7) };
}

// Pure: shift rows -> one entry per person.
export function summarizeShifts(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r.name);
    if (!by.has(k)) by.set(k, { name: r.name, hours: 0, earned: 0, shifts: 0, open: 0, tooLong: 0, noRate: 0, overlap: 0, company: r.company || null });
    const p = by.get(k);
    if (r.doubled) { p.overlap += 1; continue; } // same stretch already on their /clock shift: not paid twice, and said
    if (!r.ended_at) { p.open += 1; continue; }
    const hrs = (roundQuarterMs(new Date(r.ended_at).getTime()) - roundQuarterMs(new Date(r.started_at).getTime())) / 3600000; // nearest 15 min
    if (!(hrs > 0)) continue;
    if (hrs > (r.reviewed ? CONFIRMED_MAX_HOURS : REVIEW_HOURS)) { p.tooLong += 1; continue; }
    p.shifts += 1;
    p.hours = c2(p.hours + hrs);
    if (r.rate == null || Number(r.rate) === 0) p.noRate += 1;
    p.earned = c2(p.earned + c2(hrs * Number(r.rate || 0)));
  }
  return [...by.values()];
}

export async function payrollWeek(weekStart) {
  if (!hasDb()) return null;
  await ensurePayLedgerSchema();
  const w = weekBounds(weekStart);
  const { rows } = await query(
    `SELECT s.started_at, s.ended_at, s.rate, COALESCE(e.name, e.email) AS name, e.company
       FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE (s.started_at AT TIME ZONE 'America/Toronto')::date BETWEEN $1::date AND $2::date`, [w.start, w.end]);
  // Drivers are paid by the hour too, off the driver app's shifts (owner, 2026-11-17). Same row shape, so the same
  // rules apply (open / too long / no rate are named, never guessed). Two exceptions: an owner paid as owner is not
  // payroll, and a driver shift that overlaps the same person's /clock shift is not paid (and is named on the page),
  // because somebody on both clocks must not be paid twice for one stretch of time. Overlap is judged on the same
  // quarter hours pay is, so changing clocks at 4:03 is not an overlap. A person with BOTH an employee row and a driver account on the
  // same email is ONE person: their driver shifts are shown under the employee's name, so their hours, earnings and the
  // payments recorded against that name all land on one line. Soft-fails if the table is missing.
  try {
    const drv = await query(
      `SELECT s.started_at, s.ended_at, u.hourly_rate AS rate, COALESCE((SELECT e.name FROM employees e WHERE lower(e.email) = lower(u.email) AND e.active = true LIMIT 1),
                  NULLIF(u.name,''), u.email) AS name, NULL AS company, (s.edited_at IS NOT NULL) AS reviewed,
              EXISTS (
                SELECT 1 FROM staff_shifts ss JOIN employees e ON e.id = ss.employee_id
                 WHERE (lower(e.email) = lower(u.email) OR lower(btrim(e.name)) = lower(btrim(u.name)))
                   AND ${QUARTER('ss.started_at')} < ${QUARTER('COALESCE(s.ended_at, now())')}
                   AND ${QUARTER('COALESCE(ss.ended_at, now())')} > ${QUARTER('s.started_at')}) AS doubled
         FROM driver_shifts s JOIN users u ON u.id = s.user_id
        WHERE (s.started_at AT TIME ZONE 'America/Toronto')::date BETWEEN $1::date AND $2::date
          AND COALESCE(u.paid_as_owner, false) = false`, [w.start, w.end]);
    rows.push(...drv.rows);
  } catch { /* no driver_shifts table: staff hours only */ }
  const people = summarizeShifts(rows);

  // The older piece-rate / delivery pay for the same week, matched to people by name.
  let labor = [];
  try {
    const todayMonday = mondayOf(torontoToday());
    const offset = Math.round((new Date(`${w.start}T12:00:00Z`) - new Date(`${todayMonday}T12:00:00Z`)) / (7 * 86400000));
    labor = (await payrollReport({ weekOffset: offset }))?.workers || [];
  } catch { labor = []; }
  const byKey = new Map(people.map((p) => [keyOf(p.name), p]));
  for (const l of labor) {
    // payrollReport's amount already INCLUDES clock pay (clockPay); that is counted from the shifts above as p.earned.
    // Taking the whole amount doubled everyone's owed (Ardy 13 h = $260 showed $520). Only the non-clock part is piece work.
    const pieceOnly = c2(Number(l.amount) - Number(l.clockPay || 0));
    if (!(pieceOnly > 0)) continue;
    const k = keyOf(l.worker);
    if (!byKey.has(k)) { const p = { name: l.worker, hours: 0, earned: 0, shifts: 0, open: 0, tooLong: 0, noRate: 0, overlap: 0, company: null }; people.push(p); byKey.set(k, p); }
    byKey.get(k).piece = pieceOnly;
  }

  // What has already been posted to owed for this week.
  const posted = new Map((await query(
    `SELECT person, SUM(amount) AS amt, MIN(id) AS id FROM pay_ledger
      WHERE kind = 'owed' AND source = 'hours' AND voided_at IS NULL AND period_start = $1::date GROUP BY person`, [w.start])).rows
    .map((r) => [keyOf(r.person), { amount: c2(Number(r.amt)), id: r.id }]));

  const out = people.map((p) => {
    const total = c2(p.earned + (p.piece || 0));
    const post = posted.get(keyOf(p.name)) || null;
    return { ...p, piece: p.piece || 0, total, posted: post ? post.amount : null, stale: post ? post.amount !== total : false };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { week: w, people: out, totals: { hours: c2(out.reduce((t, p) => t + p.hours, 0)), earned: c2(out.reduce((t, p) => t + p.total, 0)) } };
}

// Write (or update) this person's owed line for the week. One per person and week, never a second.
export async function postWeekOwed({ person, weekStart, by }) {
  const week = await payrollWeek(weekStart);
  const p = week.people.find((x) => keyOf(x.name) === keyOf(person));
  if (!p || !(p.total > 0)) throw new Error('There is nothing earned for that person that week.');
  if (p.open) throw new Error(`${p.name} is still clocked in. Fix that shift first so the hours are right.`);
  const note = `${p.hours.toFixed(2)} h${p.piece ? ` + $${p.piece.toFixed(2)} piece work` : ''}, from the clock`;
  const ex = await query(
    `SELECT id FROM pay_ledger WHERE kind = 'owed' AND source = 'hours' AND voided_at IS NULL AND period_start = $1::date AND lower(person) = $2 LIMIT 1`,
    [week.week.start, keyOf(p.name)]);
  if (ex.rows[0]) {
    await query(`UPDATE pay_ledger SET amount = $2, note = $3, period_end = $4::date WHERE id = $1`, [ex.rows[0].id, p.total, note, week.week.end]);
    return { id: ex.rows[0].id, amount: p.total, updated: true };
  }
  const { rows } = await query(
    `INSERT INTO pay_ledger (person, kind, amount, period_start, period_end, note, created_by, source)
     VALUES ($1,'owed',$2,$3,$4,$5,$6,'hours') RETURNING id`, [p.name, p.total, week.week.start, week.week.end, note, by || null]);
  return { id: rows[0].id, amount: p.total, updated: false };
}

// Pay is tracked from this Monday on. Earlier weeks are not touched.
export const PAY_TRACKING_START = '2026-10-19';

// Keeps "owed" in step with the clock without anybody pressing anything. Every week since PAY_TRACKING_START is posted
// (or refreshed) for each person. A week that already carries an owed line typed by hand is left alone, so a figure the
// office entered is never doubled by the clock. Returns each person's total hours across those weeks.
export async function syncOwedFromClock(by) {
  if (!hasDb()) return [];
  const totals = new Map();
  let ws = mondayOf(PAY_TRACKING_START);
  const today = torontoToday();
  while (ws <= today) {
    const wk = await payrollWeek(ws);
    for (const p of wk.people) {
      const k = keyOf(p.name);
      if (!totals.has(k)) totals.set(k, { name: p.name, hours: 0, open: 0, tooLong: 0, noRate: 0, overlap: 0 });
      const t = totals.get(k);
      t.hours = c2(t.hours + p.hours); t.open += p.open || 0; t.tooLong += p.tooLong || 0; t.noRate += p.noRate || 0; t.overlap += p.overlap || 0;
      if (!(p.total > 0) || p.open) continue;
      if (p.posted != null && !p.stale) continue;
      const typed = await query(
        `SELECT 1 FROM pay_ledger WHERE kind = 'owed' AND source IS DISTINCT FROM 'hours' AND voided_at IS NULL AND lower(person) = $1
            AND period_start <= $3::date AND COALESCE(period_end, period_start) >= $2::date LIMIT 1`, [k, wk.week.start, wk.week.end]);
      if (typed.rows[0]) continue;
      try { await postWeekOwed({ person: p.name, weekStart: ws, by }); } catch { /* shown as a warning below */ }
    }
    // A line the clock posted earlier under a name that no longer carries these hours (one account that used to show as two
    // people, now merged) is taken off, or it would owe the same hours twice. Only the clock's own lines (source 'hours'),
    // and only voided, never deleted.
    const live = new Set(wk.people.filter((p) => p.total > 0 && !p.open).map((p) => keyOf(p.name)));
    const stale = await query(
      `SELECT id, person FROM pay_ledger WHERE kind = 'owed' AND source = 'hours' AND voided_at IS NULL AND period_start = $1::date`, [wk.week.start]);
    for (const r of stale.rows) {
      if (!live.has(keyOf(r.person)) && !wk.people.some((p) => keyOf(p.name) === keyOf(r.person))) {
        await query(`UPDATE pay_ledger SET voided_at = now(), voided_by = $2 WHERE id = $1`, [r.id, by || 'payroll sync: person merged']);
      }
    }
    ws = addDays(ws, 7);
  }
  return [...totals.values()].sort((a, b) => b.hours - a.hours);
}
