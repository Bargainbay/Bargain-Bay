// Levels for the Agent village. No imports: pure arithmetic the tests can pin.
//
// Two different things level two different things, on purpose:
//   - RELIABILITY levels the buildings. A minion earns XP for every successful run and
//     for every clean day in a row; its building's level is the sum of its minions' XP.
//   - BUSINESS RESULTS level the castle: orders placed, stops delivered, invoices paid
//     and conversations handled. The castle is the tracker and the database, which is
//     where all of that ends up.
// Level n needs base * n * (n - 1) / 2 XP in total, so each level costs a little more
// than the last and it never stops.

export const XP_PER_SUCCESS = 10;
export const XP_PER_CLEAN_DAY = 5;
export const BUILDING_BASE = 300;
export const CASTLE_BASE = 500;
export const CASTLE_WEIGHTS = { sales: 10, deliveries: 10, paid: 10, chats: 1 };

const total = (level, base) => (base * level * (level - 1)) / 2;

export function levelFor(xp, base = 100) {
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * x) / base)) / 2));
  const floor = total(level, base), next = total(level + 1, base);
  return { level, xp: x, into: x - floor, need: next - floor, pct: Math.round(((x - floor) / (next - floor)) * 100) };
}

const DAY = 86400_000;
const t = (iso) => Date.parse(`${iso}T00:00:00Z`);

// Days in a row, ending today, with no failed run. `rows` are { day: 'YYYY-MM-DD', runs, fails }.
// A weekly job has no run on most days and that is not a failure, so this counts days
// SINCE THE LAST FAILURE (or since the first record), never "days with a run".
export function cleanStreak(rows, todayIso) {
  if (!rows || !rows.length) return 0;
  const first = rows.reduce((m, r) => (r.day < m ? r.day : m), rows[0].day);
  const lastFail = rows.filter((r) => Number(r.fails) > 0).reduce((m, r) => (r.day > m ? r.day : m), '');
  const start = lastFail ? t(lastFail) + DAY : t(first);
  return Math.max(0, Math.floor((t(todayIso) - start) / DAY) + 1);
}

// A minion's XP. With history: 10 per successful run plus 5 per clean day. Without it
// (the table is new or unreadable) the lifetime run count stands in, so nobody starts
// from nothing on the day this ships.
export function minionXp({ rows = [], lifetimeRuns = 0, todayIso }) {
  if (!rows.length) return Math.max(0, Number(lifetimeRuns) || 0) * XP_PER_SUCCESS;
  const runs = rows.reduce((n, r) => n + Number(r.runs), 0);
  const fails = rows.reduce((n, r) => n + Number(r.fails), 0);
  return Math.max(0, runs - fails) * XP_PER_SUCCESS + cleanStreak(rows, todayIso) * XP_PER_CLEAN_DAY;
}

export function castleXp(b = {}) {
  return Object.entries(CASTLE_WEIGHTS).reduce((n, [k, w]) => n + (Number(b[k]) || 0) * w, 0);
}
