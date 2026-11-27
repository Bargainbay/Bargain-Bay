// Day-by-day net profit and the money to put back into product, for the owner's
// Sales dashboard. Cost-bearing: admins only. Read-only.
import { query, hasDb } from './db';
import { torontoToday } from './constants';
import { dailyPnl, listCosts } from './daily-pnl';
import { salesByDate } from './analytics';
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

export async function dayMoney({ from, to } = {}) {
  if (!hasDb()) return null;
  const today = torontoToday();
  const end = DAY.test(to || '') && to <= today ? to : today;
  const start = DAY.test(from || '') && from <= end ? from : back(end, 13);
  // People still on the clock are costed up to this minute, or today would read
  // better than it is until everyone has gone home.
  const pnl = await dailyPnl({ from: start, to: end, asOf: new Date().toISOString() });
  const [sold, costs, firstClock] = await Promise.all([
    salesByDate(pnl.from, pnl.to), listCosts().catch(() => []), clockStart()
  ]);
  const rows = pnl.rows.map((d) => moneyDay(d, sold.get(d.day)));
  const totals = addUp(rows);

  // Everything that makes net profit read higher than it really is, said plainly.
  const notes = [];
  const blank = costs.filter((c) => !(c.amount > 0)).length;
  if (blank) notes.push({ text: `${blank} bills on the cost list are still $0, so net profit reads higher than it really is.`, href: '/admin/costs', link: 'Fill them in' });
  if (rows.length && !totals.fuel) notes.push({ text: 'No fuel has been recorded for these days.' });
  if (firstClock && pnl.from < firstClock) notes.push({ text: `Nobody was clocking in before ${firstClock}, so wages are missing for earlier days.` });
  if (pnl.to === today) notes.push({ text: 'Today counts wages up to this minute for anyone still clocked in, so its net profit keeps moving until the day is done.' });
  for (const w of pnl.warnings) if (!/cost list is empty/.test(w)) notes.push({ text: w });
  notes.push({ text: 'Rep commission and HST are not taken off or set aside here.' });

  return { today, from: pnl.from, to: pnl.to, rows, totals, notes };
}

/** Put net profit and the restock figure on the Today / week / month cards. */
export async function withNet(profit) {
  const co = profit?.company;
  if (!co) return profit;
  try {
    const month0 = `${profit.today.slice(0, 7)}-01`;
    const from = co.week.from < month0 ? co.week.from : month0;
    const m = await dayMoney({ from, to: profit.today });
    const span = (a) => {
      const t = addUp(m.rows.filter((r) => r.day >= a));
      return { net: t.net, restock: t.restock };
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
