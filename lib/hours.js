// Everybody's hours, in one list, for any date range.
//
// Two clocks exist and nothing read them together:
//   staff_shifts   warehouse / office / sales, clock in at /clock (lib/team-clock.js)
//   driver_shifts  drivers, with a van and an odometer (lib/shifts.js)
// This reads both and puts them in one shape, so the hours page, the payroll
// report and a "who worked last week" question all see the same rows.
//
// Rules carried over from the Daily P&L and the Profit tab, so the three agree:
//   - a shift still clocked in, or longer than MAX_SHIFT_HOURS, is LISTED but
//     is never added into hours or money; it is counted and named instead
//   - a staff shift is costed at the rate SNAPSHOTTED when it started; a driver
//     shift at users.hourly_rate, and an owner (paid_as_owner) costs nothing
//   - a day is the Toronto day the shift STARTED on
import { query, hasDb } from './db';
import { round2, MAX_SHIFT_HOURS, torontoToday } from './constants';

const n = (v) => Number(v || 0);
const DAY = (col) => `(${col} AT TIME ZONE 'America/Toronto')::date`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 400;

const addDays = (iso, d) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

/** Monday..Sunday of the week `offset` weeks from this one (0 = this week). */
export function weekRange(offset = 0, today = torontoToday()) {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const monday = addDays(today, -dow + 7 * (Number(offset) || 0));
  return { from: monday, to: addDays(monday, 6) };
}

/** The one-tap ranges on the page. Weeks run Monday to Sunday. */
export function presetRange(key, today = torontoToday()) {
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'this_week': return weekRange(0, today);
    case 'last_week': return weekRange(-1, today);
    case 'two_weeks_ago': return weekRange(-2, today);
    case 'this_month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      const last = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      last.setUTCDate(0);
      return { from, to: last.toISOString().slice(0, 10) };
    }
    default: return null;
  }
}

const hoursOf = (start, end) => (start && end ? (new Date(end) - new Date(start)) / 3600000 : null);

/** Classify one shift. The order matters: an unclosed shift has no length to judge. */
function judge(h, rate, owner) {
  if (h == null) return 'open';
  if (h < 0 || h > MAX_SHIFT_HOURS) return 'too_long';
  if (owner) return 'owner';
  if (!(rate > 0)) return 'no_rate';
  return 'ok';
}

async function staffRows(from, to) {
  const { rows } = await query(
    `SELECT s.id, s.started_at, s.ended_at, s.rate, s.note, s.edited_by,
            ${DAY('s.started_at')}::text AS day,
            COALESCE(NULLIF(e.name,''), e.email) AS name, lower(e.email) AS email,
            e.company, e.role_label
       FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
      WHERE ${DAY('s.started_at')} BETWEEN $1::date AND $2::date
      ORDER BY s.started_at`, [from, to]);
  return rows.map((r) => {
    const h = hoursOf(r.started_at, r.ended_at);
    const rate = r.rate == null ? null : n(r.rate);
    return {
      source: 'staff', id: r.id, person: r.name, email: r.email, company: r.company || null,
      role: r.role_label || null, day: r.day, start: r.started_at, end: r.ended_at,
      hours: h, rate, edited: !!r.edited_by, note: r.note || null,
      status: judge(h, rate, false)
    };
  });
}

async function driverRows(from, to) {
  try {
    const { rows } = await query(
      `SELECT s.id, s.started_at, s.ended_at, s.driving, s.note, s.edited_by,
              ${DAY('s.started_at')}::text AS day,
              COALESCE(NULLIF(u.name,''), u.email) AS name, lower(u.email) AS email,
              u.hourly_rate, COALESCE(u.paid_as_owner, false) AS owner, v.name AS van
         FROM driver_shifts s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE ${DAY('s.started_at')} BETWEEN $1::date AND $2::date
        ORDER BY s.started_at`, [from, to]);
    return rows.map((r) => {
      const h = hoursOf(r.started_at, r.ended_at);
      const rate = r.hourly_rate == null ? null : n(r.hourly_rate);
      return {
        source: 'driver', id: r.id, person: r.name || 'Unknown driver', email: r.email, company: null,
        role: r.driving ? `Driver${r.van ? ` (${r.van})` : ''}` : 'Riding along', day: r.day,
        start: r.started_at, end: r.ended_at, hours: h, rate, owner: r.owner,
        edited: !!r.edited_by, note: r.note || null, status: judge(h, rate, r.owner)
      };
    });
  } catch { return []; }
}

/**
 * Every shift from both clocks in [from, to], plus a per-person roll-up.
 * `people[].hours` and `.cost` only ever include shifts that are `ok`, `owner`
 * (hours only) or `no_rate` (hours only), so the totals match the P&L.
 */
export async function hoursReport({ from, to } = {}) {
  const today = torontoToday();
  const end = ISO.test(to || '') ? to : today;
  let start = ISO.test(from || '') ? from : end;
  if (start > end) start = end;
  if (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`) > MAX_RANGE_DAYS * 86400000) start = addDays(end, -MAX_RANGE_DAYS);
  const empty = { from: start, to: end, today, shifts: [], people: [], totals: { hours: 0, cost: 0, shifts: 0, open: 0, tooLong: 0, noRate: 0 }, warnings: [] };
  if (!hasDb()) return empty;

  const [staff, drivers] = await Promise.all([staffRows(start, end), driverRows(start, end)]);
  const shifts = [...staff, ...drivers].sort((a, b) => new Date(b.start) - new Date(a.start));

  const byPerson = new Map();
  for (const s of shifts) {
    const key = (s.email || s.person || '').toLowerCase();
    if (!byPerson.has(key)) {
      byPerson.set(key, { person: s.person, email: s.email, sources: new Set(), roles: new Set(), hours: 0, cost: 0, shifts: 0, open: 0, tooLong: 0, noRate: 0, ownerHours: 0, days: new Set() });
    }
    const p = byPerson.get(key);
    p.sources.add(s.source);
    if (s.role) p.roles.add(s.role);
    p.shifts += 1;
    if (s.status === 'open') { p.open += 1; continue; }
    if (s.status === 'too_long') { p.tooLong += 1; continue; }
    p.hours += s.hours;
    p.days.add(s.day);
    if (s.status === 'owner') p.ownerHours += s.hours;
    else if (s.status === 'no_rate') p.noRate += 1;
    else p.cost += s.hours * s.rate;
  }

  const people = [...byPerson.values()].map((p) => ({
    person: p.person, email: p.email, sources: [...p.sources], roles: [...p.roles],
    hours: round2(p.hours), cost: round2(p.cost), shifts: p.shifts, daysWorked: p.days.size,
    open: p.open, tooLong: p.tooLong, noRate: p.noRate, ownerHours: round2(p.ownerHours)
  })).sort((a, b) => b.hours - a.hours);

  const sum = (k) => people.reduce((a, p) => a + p[k], 0);
  const totals = {
    hours: round2(sum('hours')), cost: round2(sum('cost')), shifts: shifts.length,
    open: sum('open'), tooLong: sum('tooLong'), noRate: sum('noRate')
  };

  const warnings = [];
  if (totals.open) warnings.push(`${totals.open} shift${totals.open === 1 ? ' is' : 's are'} still clocked in, so ${totals.open === 1 ? 'its' : 'their'} hours are not counted yet.`);
  if (totals.tooLong) warnings.push(`${totals.tooLong} shift${totals.tooLong === 1 ? '' : 's'} ran past ${MAX_SHIFT_HOURS} hours (or end before start) and are left out until corrected.`);
  if (totals.noRate) warnings.push(`${totals.noRate} shift${totals.noRate === 1 ? '' : 's'} belong to people with no hourly rate, so the hours count but the cost is $0.`);
  const both = people.filter((p) => p.sources.length > 1);
  if (both.length) warnings.push(`${both.map((p) => p.person).join(', ')} ${both.length === 1 ? 'is' : 'are'} on BOTH clocks (staff and driver). Their hours are counted twice in payroll and the P&L unless one of the two is turned off.`);

  return { from: start, to: end, today, shifts, people, totals, warnings };
}
