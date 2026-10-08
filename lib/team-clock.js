// Sign in / sign out for everybody who is not a delivery driver. Drivers keep
// their own shifts (lib/shifts.js) because theirs carry a van and an odometer;
// this is deliberately the SMALL version -- a person, a start, an end.
//
// Tables are in db/migrations/0016. Nothing here creates a table at runtime.
import { query, hasDb } from './db';
import { round2, MAX_SHIFT_HOURS, torontoToday } from './constants';
import { normalizeEmail } from './auth';

const n = (v) => Number(v || 0);
const clean = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const DAY = (col) => `(${col} AT TIME ZONE 'America/Toronto')::date`;

const shapeEmployee = (r) => ({
  id: r.id, email: r.email, name: r.name, roleLabel: r.role_label,
  hourlyRate: r.hourly_rate == null ? null : Number(r.hourly_rate),
  active: r.active, addedAt: r.added_at, endedAt: r.ended_at
});

export async function employeeByEmail(email) {
  if (!hasDb() || !email) return null;
  const { rows } = await query(
    'SELECT * FROM employees WHERE lower(email) = $1 AND active = true', [normalizeEmail(email)]);
  return rows[0] ? shapeEmployee(rows[0]) : null;
}

export async function listEmployees({ includeEnded = false } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT * FROM employees ${includeEnded ? '' : 'WHERE active = true'} ORDER BY active DESC, lower(coalesce(name, email))`);
  return rows.map(shapeEmployee);
}

/** Add (or re-activate, or update) an employee by email. */
export async function saveEmployee({ email, name, roleLabel, hourlyRate }, by) {
  const em = normalizeEmail(email);
  if (!em || !em.includes('@')) throw new Error('Give their email address -- it is how they sign in.');
  let rate = null;
  if (hourlyRate !== '' && hourlyRate != null) {
    rate = Number(hourlyRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 500) throw new Error('Hourly rate must be a number like 18.50.');
    rate = round2(rate);
  }
  const { rows } = await query(
    `INSERT INTO employees (email, name, role_label, hourly_rate, added_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (lower(email)) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, employees.name),
            role_label = COALESCE(EXCLUDED.role_label, employees.role_label),
            hourly_rate = EXCLUDED.hourly_rate,
            active = true, ended_at = NULL
     RETURNING *`,
    [em, clean(name), clean(roleLabel, 60), rate, by || null]);
  return shapeEmployee(rows[0]);
}

/** Stops them clocking in. The row and their shifts stay. */
export async function endEmployee(id) {
  const open = await query('SELECT 1 FROM staff_shifts WHERE employee_id = $1 AND ended_at IS NULL', [id]);
  if (open.rows.length) throw new Error('They are clocked in right now. Clock them out first (Fix times), then remove them.');
  await query('UPDATE employees SET active = false, ended_at = now() WHERE id = $1', [id]);
  return true;
}

const shapeShift = (r) => ({
  id: r.id, employeeId: r.employee_id, name: r.name, startedAt: r.started_at,
  endedAt: r.ended_at, rate: r.rate == null ? null : Number(r.rate), note: r.note,
  minutes: r.ended_at ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000) : null
});

export async function openStaffShift(employeeId) {
  const { rows } = await query(
    `SELECT s.*, e.name FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE s.employee_id = $1 AND s.ended_at IS NULL`, [employeeId]);
  return rows[0] ? shapeShift(rows[0]) : null;
}

/** Today's finished shifts for one person -- shown under the button. */
export async function recentStaffShifts(employeeId, limit = 8) {
  const { rows } = await query(
    `SELECT s.*, e.name FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE s.employee_id = $1 ORDER BY s.started_at DESC LIMIT $2`, [employeeId, limit]);
  return rows.map(shapeShift);
}

export async function clockIn(employee, { ref } = {}) {
  // The partial unique index is the real guard; checking first just gives the
  // person a sentence instead of a constraint name.
  const open = await openStaffShift(employee.id);
  if (open) return { shift: open, already: true };
  try {
    const { rows } = await query(
      `INSERT INTO staff_shifts (employee_id, started_at, rate, ref)
       VALUES ($1, now(), $2, $3) RETURNING *`, [employee.id, employee.hourlyRate, clean(ref, 60)]);
    return { shift: shapeShift({ ...rows[0], name: employee.name }), already: false };
  } catch (e) {
    if (String(e.message).includes('staff_shifts_open')) return { shift: await openStaffShift(employee.id), already: true };
    throw e;
  }
}

export async function clockOut(employee, { note } = {}) {
  const { rows } = await query(
    `UPDATE staff_shifts SET ended_at = now(), note = COALESCE($2, note)
      WHERE employee_id = $1 AND ended_at IS NULL RETURNING *`, [employee.id, clean(note, 300)]);
  if (!rows.length) return { shift: null, already: true };
  return { shift: shapeShift({ ...rows[0], name: employee.name }), already: false };
}

// Office correction: a forgotten clock-out is the ordinary failure, so this is
// the ordinary repair. Times are Toronto local on the shift's day, the way a
// person says them ("5:30pm"), converted in Postgres so DST is nobody's problem.
export async function fixStaffShift(id, { date, start, end, clear }, by) {
  const cur = (await query('SELECT * FROM staff_shifts WHERE id = $1', [id])).rows[0];
  if (!cur) throw new Error('No such shift.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date
    : new Date(cur.started_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const tm = (v) => (/^\d{1,2}:\d{2}$/.test(v || '') ? v : null);
  const s = tm(start), e = tm(end);
  const { rows } = await query(
    `UPDATE staff_shifts SET
        started_at = COALESCE(CASE WHEN $2::text IS NOT NULL THEN ($4::date + $2::time) AT TIME ZONE 'America/Toronto' END, started_at),
        ended_at = CASE WHEN $6::boolean THEN NULL
                        WHEN $3::text IS NOT NULL THEN ($4::date + $3::time) AT TIME ZONE 'America/Toronto'
                        ELSE ended_at END,
        edited_by = $5
      WHERE id = $1 RETURNING *`,
    [id, s, e, day, by || null, !!clear]);
  return rows[0];
}

/** One day's staff cost and hours, plus what could not be priced. */
export async function staffLabourByDay(from, to) {
  if (!hasDb()) return { days: new Map(), unpriced: 0, noRate: 0, open: 0 };
  const { rows } = await query(
    `SELECT ${DAY('s.started_at')}::text AS day,
            COALESCE(SUM(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 3600.0 * COALESCE(s.rate,0))
              FILTER (WHERE s.ended_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) <= $3 * 3600), 0) AS cost,
            COALESCE(SUM(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 3600.0)
              FILTER (WHERE s.ended_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) <= $3 * 3600), 0) AS hours,
            COUNT(*) FILTER (WHERE s.ended_at IS NULL)::int AS open,
            COUNT(*) FILTER (WHERE s.ended_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) > $3 * 3600)::int AS too_long,
            COUNT(*) FILTER (WHERE s.ended_at IS NOT NULL AND COALESCE(s.rate,0) = 0)::int AS no_rate
       FROM staff_shifts s
      WHERE ${DAY('s.started_at')} BETWEEN $1::date AND $2::date
      GROUP BY 1`, [from, to, MAX_SHIFT_HOURS]);
  const days = new Map(rows.map((r) => [r.day, {
    cost: round2(n(r.cost)), hours: round2(n(r.hours)), open: r.open, tooLong: r.too_long, noRate: r.no_rate
  }]));
  const sum = (k) => [...days.values()].reduce((a, d) => a + d[k], 0);
  return { days, unpriced: sum('open') + sum('tooLong'), noRate: sum('noRate'), open: sum('open') };
}

/** Who worked when -- the admin hours table. */
export async function staffShiftReport(from, to) {
  if (!hasDb()) return [];
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : torontoToday();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : start;
  const { rows } = await query(
    `SELECT s.*, COALESCE(e.name, e.email) AS name FROM staff_shifts s
       JOIN employees e ON e.id = s.employee_id
      WHERE ${DAY('s.started_at')} BETWEEN $1::date AND $2::date
      ORDER BY s.started_at DESC LIMIT 500`, [start, end]);
  return rows.map(shapeShift);
}
