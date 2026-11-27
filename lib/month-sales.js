// The arithmetic behind the month-by-day chart. Runs in the browser; no database,
// and "today" is always passed in (the server decides it, in Toronto time).
//
// A day that has not happened yet is NULL, never zero: a running month drawn with
// zeros to the 30th would read as a collapse in sales.
const pad = (n) => String(n).padStart(2, '0');

export const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const weekdayOf = (month, day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${month}-${pad(day)}T00:00:00Z`).getUTCDay()];
export const isRunning = (month, today) => today.slice(0, 7) === month;

/** How many days of `month` have happened (today included). */
export function elapsedDays(month, today) {
  const now = today.slice(0, 7);
  if (month < now) return daysIn(month);
  return month > now ? 0 : Number(today.slice(8, 10));
}

/** One value per day of the month (index 0 = the 1st), null for days still to come. */
export function daySeries(rows, month, today, measure) {
  const by = new Map((rows || []).map((r) => [r.d, Number(r[measure]) || 0]));
  const done = elapsedDays(month, today);
  return Array.from({ length: daysIn(month) }, (_, i) => (i < done ? by.get(i + 1) || 0 : null));
}

export function runningTotal(series) {
  let sum = 0;
  return series.map((v) => (v == null ? null : (sum = Math.round((sum + v) * 100) / 100)));
}

/**
 * When one of the chosen months is still running, the others are also totalled to
 * the same day of the month, so a part month is not judged against whole ones.
 * Null when every chosen month is finished.
 */
export function sameDayCut(months, today) {
  return months.some((m) => isRunning(m, today)) ? Number(today.slice(8, 10)) : null;
}

export function monthSummary(rows, month, today, measure, cut = null) {
  const s = daySeries(rows, month, today, measure).filter((v) => v != null);
  const add = (list) => Math.round(list.reduce((a, v) => a + v, 0) * 100) / 100;
  const total = add(s);
  const sold = new Set((rows || []).filter((r) => r.sales > 0 && r.d <= s.length).map((r) => r.d));
  let best = null;
  s.forEach((v, i) => { if (v > 0 && (!best || v > best.value)) best = { day: i + 1, value: v }; });
  return {
    month, total, days: s.length, daysSold: sold.size,
    average: s.length ? total / s.length : 0,
    best,
    toCut: cut == null ? total : add(s.slice(0, cut))
  };
}

/** Percentage by which `a` differs from `b`; null when there is nothing to compare against. */
export const change = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
