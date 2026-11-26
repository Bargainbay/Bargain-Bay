// The running split of the bankroll: product to put back, labour to set aside, running costs, profit.
// Built on dailyPnl() so it agrees to the cent with the Daily P&L and the dispatch Profit tab; the arithmetic
// is in cash-split-math.js. Read-only.
import { query, hasDb } from './db';
import { torontoToday } from './constants';
import { dailyPnl, MAX_DAYS } from './daily-pnl';
import { rollUp } from './cash-split-math';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Stock bought in the period, from supplier invoices (pre-tax subtotal, dated to the invoice).
// Null when the table cannot be read, so "unknown" is never shown as "bought nothing".
async function stockBought(from, to) {
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(subtotal), 0) AS v FROM purchase_invoices WHERE invoice_date BETWEEN $1::date AND $2::date`, [from, to]);
    return Number(rows[0].v);
  } catch { return null; }
}

export async function cashSplit({ from, to } = {}) {
  const today = torontoToday();
  const end = DAY.test(to || '') ? to : today;
  const start = DAY.test(from || '') ? from : `${end.slice(0, 7)}-01`;
  if (!hasDb()) return null;
  const pnl = await dailyPnl({ from: start, to: end });
  const bought = await stockBought(pnl.from, pnl.to);
  const split = rollUp(pnl.rows, bought);
  // The bankroll right now, for comparison. Soft: the split stands without it.
  let bankroll = null;
  try {
    const { bankrollSummary } = await import('./bankroll');
    const b = await bankrollSummary(undefined, { days: 1 });
    if (b) bankroll = { total: b.total, bankKnown: b.bankKnown, cashKnown: b.cashKnown };
  } catch { /* no bankroll tables */ }
  return { from: pnl.from, to: pnl.to, today, maxDays: MAX_DAYS, ...split, bankroll, warnings: pnl.warnings };
}
