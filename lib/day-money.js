// Day-by-day net profit and the money to put back into product, for the owner's
// Sales dashboard. Cost-bearing: admins only. Read-only.
import { query, hasDb } from './db';
import { torontoToday, money } from './constants';
import { dailyPnl, listCosts } from './daily-pnl';
import { salesByDate, notOperatingCost } from './analytics';
import { ensureFinanceSchema } from './finance';
import { ensureBankActivitySchema } from './bank-activity';
import { moneyDay, addUp } from './day-money-math';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const back = (iso, days) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - days); return t.toISOString().slice(0, 10); };

// The first day anybody clocked in. Before it, no wages are on record.
async function clockStart() {
  try {
    const { rows } = await query(`SELECT (MIN(started_at) AT TIME ZONE 'America/Toronto')::date::text AS d FROM staff_shifts`);
    return rows[0]?.d || null;
  } catch { return null; }
}

// What was really paid, line by line: bank, cash and own pocket. Templates that
// post themselves (recurring) are not a payment. `counted` follows the same rule
// as the P&L and the Financial page: stock, owner draws, loan repayments, receipt
// paybacks and passed-on money are money moving, not a running cost.
export async function spendLines(from, to) {
  await ensureFinanceSchema();
  const { rows } = await query(
    `SELECT to_char(incurred_on,'YYYY-MM-DD') AS day, category, vendor, source, amount + COALESCE(tax,0) AS paid
       FROM expenses WHERE incurred_on BETWEEN $1::date AND $2::date AND recurring_id IS NULL
      ORDER BY incurred_on, paid DESC`, [from, to]);
  return rows.map((r) => ({
    day: r.day, category: r.category || 'No category', vendor: r.vendor || '', source: r.source || 'manual',
    paid: Number(r.paid) || 0, counted: !notOperatingCost(r.category)
  }));
}

// Per day: spent on running the business, and money that left the bank with no
// category yet. Null for a day before the bank feed began, or if it cannot be read.
async function actualByDay(from, to) {
  try {
    const lines = await spendLines(from, to);
    await ensureBankActivitySchema();
    const [first, open] = await Promise.all([
      query(`SELECT to_char(LEAST((SELECT MIN(incurred_on) FROM expenses WHERE source = 'plaid'),
                                  (SELECT MIN(activity_date) FROM bank_activity)),'YYYY-MM-DD') AS d`),
      query(`SELECT to_char(activity_date,'YYYY-MM-DD') AS day, COALESCE(SUM(-amount),0) AS v FROM bank_activity
              WHERE amount < 0 AND pending = false AND activity_date BETWEEN $1::date AND $2::date GROUP BY 1`, [from, to])
    ]);
    const start = first.rows[0]?.d || null;
    const unsorted = new Map(open.rows.map((r) => [r.day, Number(r.v) || 0]));
    const spent = new Map();
    for (const l of lines) if (l.counted) spent.set(l.day, (spent.get(l.day) || 0) + l.paid);
    return {
      start,
      of: (day) => (start && day >= start ? { spent: spent.get(day) || 0, unsorted: unsorted.get(day) || 0 } : null)
    };
  } catch (e) {
    console.error('actual spending failed', e.message);
    return { start: null, of: () => null };
  }
}

export async function dayMoney({ from, to } = {}) {
  if (!hasDb()) return null;
  const today = torontoToday();
  const end = DAY.test(to || '') && to <= today ? to : today;
  const start = DAY.test(from || '') && from <= end ? from : back(end, 13);
  // People still on the clock are costed up to this minute, or today would read
  // better than it is until everyone has gone home.
  const pnl = await dailyPnl({ from: start, to: end, asOf: new Date().toISOString() });
  const [sold, costs, firstClock, actual] = await Promise.all([
    salesByDate(pnl.from, pnl.to), listCosts().catch(() => []), clockStart(), actualByDay(pnl.from, pnl.to)
  ]);
  const rows = pnl.rows.map((d) => moneyDay(d, sold.get(d.day), actual.of(d.day)));
  const totals = addUp(rows);

  // Everything that makes net profit read higher than it really is, said plainly.
  const notes = [];
  if (totals.unsorted > 0) notes.push({ text: `${money(totals.unsorted)} of bank transfers in these days has no category yet and is not counted, so actual net profit reads higher than it is.`, href: '/admin/bankroll', link: 'Sort them' });
  if (rows.some((r) => r.actualNet == null)) notes.push({ text: actual.start ? `The bank is on record from ${actual.start}, so there is no actual net profit before that.` : 'The bank spending could not be read, so there is no actual net profit.' });
  else notes.push({ text: 'Actual counts each bill on the day it was paid (bank, cash and own pocket, HST included), so pay days and rent days swing it. Stock payments, owner draws, loan repayments, receipt paybacks and passed-on money are not counted. The bank can run a day or two behind.' });
  const blank = costs.filter((c) => !(c.amount > 0)).length;
  if (blank) notes.push({ text: `${blank} bills on the cost list are still $0, so proposed net profit reads higher than it really is.`, href: '/admin/costs', link: 'Fill them in' });
  if (rows.length && !totals.fuel) notes.push({ text: 'No driver fuel is entered for these days, so proposed net profit leaves fuel out.' });
  if (firstClock && pnl.from < firstClock) notes.push({ text: `Nobody was clocking in before ${firstClock}, so wages are missing for earlier days.` });
  if (pnl.to === today) notes.push({ text: 'Today counts wages up to this minute for anyone still clocked in, so its proposed net profit keeps moving until the day is done.' });
  for (const w of pnl.warnings) if (!/cost list is empty/.test(w)) notes.push({ text: w });
  notes.push({ text: 'Rep commission and HST are not taken off or set aside here.' });

  return { today, from: pnl.from, to: pnl.to, rows, totals, notes };
}

/** Put both net profits and the restock figure on the Today / week / month cards. */
export async function withNet(profit) {
  const co = profit?.company;
  if (!co) return profit;
  try {
    const month0 = `${profit.today.slice(0, 7)}-01`;
    const from = co.week.from < month0 ? co.week.from : month0;
    const m = await dayMoney({ from, to: profit.today });
    const span = (a) => {
      const t = addUp(m.rows.filter((r) => r.day >= a));
      return { net: t.net, restock: t.restock, spent: t.spent, actualNet: t.actualNet, unsorted: t.unsorted };
    };
    return {
      ...profit,
      company: {
        ...co,
        today: { ...co.today, ...span(profit.today) },
        week: { ...co.week, ...span(co.week.from) },
        month: { ...co.month, ...span(month0) }
      }
    };
  } catch (e) {
    // The sales cards must still show if the cost side cannot be read.
    console.error('net profit failed', e.message);
    return profit;
  }
}
