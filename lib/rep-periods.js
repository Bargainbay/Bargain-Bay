// Date arithmetic for the sales trend and comparison charts. NO IMPORTS — it runs
// in the browser, and every function takes "today" as an argument rather than
// reading a clock, so the Toronto-vs-UTC question is answered once, by the
// server, and never re-asked on a laptop in another zone.
//
// Everything is a plain 'YYYY-MM-DD' string and every range is HALF-OPEN
// [from, to): "this month" ends on the 1st of next month, not the 31st, so a
// sale at 23:59 on the last day is never on the wrong side of a comparison.
const MS = 86400000;
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, n) => fmt(parse(iso) + n * MS);
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / MS);
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export function addMonths(iso, n) {
  const d = new Date(parse(monthStart(iso)));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d.getTime());
}
// ISO weeks start on Monday — the same week payroll and the dashboard use.
export const mondayOf = (iso) => addDays(iso, -((new Date(parse(iso)).getUTCDay() + 6) % 7));

export const GRANULARITIES = ['day', 'week', 'month'];
export const bucketStart = (iso, gran) => (gran === 'week' ? mondayOf(iso) : gran === 'month' ? monthStart(iso) : iso);
const nextBucket = (iso, gran) => (gran === 'week' ? addDays(iso, 7) : gran === 'month' ? addMonths(iso, 1) : addDays(iso, 1));

/** How many buckets each granularity shows by default. */
export const DEFAULT_SPAN = { day: 14, week: 12, month: 12 };

/** The last `n` bucket starts, oldest first, ending with the one containing today. */
export function bucketList(gran, n, today) {
  const out = [];
  let cur = bucketStart(today, gran);
  for (let i = 0; i < n; i++) { out.unshift(cur); cur = gran === 'week' ? addDays(cur, -7) : gran === 'month' ? addMonths(cur, -1) : addDays(cur, -1); }
  return out;
}
export { nextBucket };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
export const monthName = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function bucketLabel(iso, gran) {
  const m = SHORT[Number(iso.slice(5, 7)) - 1];
  if (gran === 'month') return `${m} ${iso.slice(2, 4)}`;
  return `${m} ${Number(iso.slice(8, 10))}`;
}

/**
 * A named period → { key, label, from, to }. Keys: today, yesterday, week,
 * last_week, month, last_month, or a calendar month as 'YYYY-MM'.
 */
export function presetRange(key, today) {
  switch (key) {
    case 'today': return { key, label: 'Today', from: today, to: addDays(today, 1) };
    case 'yesterday': return { key, label: 'Yesterday', from: addDays(today, -1), to: today };
    case 'week': { const f = mondayOf(today); return { key, label: 'This week', from: f, to: addDays(f, 7) }; }
    case 'last_week': { const f = addDays(mondayOf(today), -7); return { key, label: 'Last week', from: f, to: addDays(f, 7) }; }
    case 'month': { const f = monthStart(today); return { key, label: 'This month', from: f, to: addMonths(f, 1) }; }
    case 'last_month': { const f = addMonths(today, -1); return { key, label: 'Last month', from: f, to: addMonths(f, 1) }; }
    default: {
      if (/^\d{4}-\d{2}$/.test(String(key))) {
        const f = `${key}-01`;
        return { key, label: monthName(f), from: f, to: addMonths(f, 1) };
      }
      return null;
    }
  }
}

/** Days of the range that have actually happened (a range still running is short). */
export const elapsedDays = (r, today) => Math.max(0, Math.min(daysBetween(r.from, r.to), daysBetween(r.from, addDays(today, 1))));

/**
 * Put two periods on the same footing. A week that is three days old set against
 * a finished week reads as a collapse on Tuesday morning, so with `aligned` both
 * are cut to the shorter of the two elapsed lengths — Monday–Wednesday against
 * Monday–Wednesday. Returns the ranges plus a note saying so, because a chart
 * that quietly drops days is lying about what it shows.
 */
export function alignPair(a, b, today, aligned = true) {
  const la = elapsedDays(a, today), lb = elapsedDays(b, today);
  const full = (r) => daysBetween(r.from, r.to);
  if (!aligned || (la === full(a) && lb === full(b) && la === lb)) return { a, b, cut: null };
  const n = Math.min(la, lb);
  const cut = (r) => ({ ...r, to: addDays(r.from, n) });
  const changed = n !== full(a) || n !== full(b);
  return { a: cut(a), b: cut(b), cut: changed ? n : null };
}

/** The common comparisons, as buttons. */
export const COMPARE_PRESETS = [
  { key: 'day', label: 'Today vs yesterday', a: 'today', b: 'yesterday' },
  { key: 'week', label: 'This week vs last week', a: 'week', b: 'last_week' },
  { key: 'month', label: 'This month vs last month', a: 'month', b: 'last_month' }
];

export const METRICS = {
  revenue: { label: 'Revenue', money: true },
  sales: { label: 'Sales', money: false },
  ownRevenue: { label: 'Own-lead revenue', money: true },
  ownSales: { label: 'Own-lead sales', money: false }
};

/** Daily rows for one range → { 'YYYY-MM-DD': value }, optionally for one rep. */
export function dailyTotals(rows, range, metric, rep = 'all') {
  const out = {};
  for (const r of rows) {
    if (r.d < range.from || r.d >= range.to) continue;
    if (rep !== 'all' && r.rep !== rep) continue;
    out[r.d] = (out[r.d] || 0) + (r[metric] || 0);
  }
  return out;
}

/** Running total by day number (index 0 = day 1). Days not yet happened are null. */
export function cumulative(rows, range, metric, rep, today) {
  const per = dailyTotals(rows, range, metric, rep);
  const n = daysBetween(range.from, range.to), seen = elapsedDays(range, today);
  const out = []; let run = 0;
  for (let i = 0; i < n; i++) {
    if (i >= seen) { out.push(null); continue; }
    run += per[addDays(range.from, i)] || 0;
    out.push(run);
  }
  return out;
}

/** Per-rep total for a range. */
export function totalsByRep(rows, range, metric) {
  const out = {};
  for (const r of rows) {
    if (r.d < range.from || r.d >= range.to) continue;
    out[r.rep] = (out[r.rep] || 0) + (r[metric] || 0);
  }
  return out;
}
