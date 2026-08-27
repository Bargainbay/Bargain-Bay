// A proper profit & loss statement, as opposed to the dashboard's tiles.
//
// The dashboard answers "how are we doing"; this answers "where did the money
// go", line by line, in a shape an accountant recognises and the owner can hand
// over. Revenue → COGS → gross profit → operating expenses, itemised by category
// → net profit, with the previous period beside it.
//
// BASIS: the same one as everything else here — a sale counts on the day it was
// made (`SALE` in lib/analytics.js), an expense on the day it was incurred. That
// keeps this statement reconcilable with the Sales dashboard rather than being a
// third opinion.
import { query, hasDb } from './db';
import { round2 } from './constants';
import { laborCostBetween } from './payroll';

const TZ = "AT TIME ZONE 'America/Toronto'";
const NOW = `(now() ${TZ})`;
const LT = (col) => `(${col} ${TZ})`;
const n = (v) => Number(v || 0);

// Mirrors lib/analytics.js — a settled order, or a deposit sale still awaiting
// its balance behind a live invoice. Kept in step deliberately: a P&L that
// disagreed with the revenue dashboard would be worse than no P&L.
const SALE = (t = 'o') => `(
  ${t}.status IN ('confirmed','ready','out_for_delivery','delivered')
  OR (${t}.status = 'pending_payment'
      AND EXISTS (SELECT 1 FROM invoices bi
                   WHERE bi.order_id = ${t}.id AND bi.status IN ('open','partial')))
)`;

// Month, quarter and year windows, plus the comparable one before it.
export const PNL_PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'year', label: 'This year' }
];

function windowFor(period) {
  const M = (unit, back = 0) => `(date_trunc('${unit}',${NOW}) - interval '${back} ${unit}')`;
  switch (period) {
    case 'last_month': return { cur: [M('month', 1), M('month', 0)], prev: [M('month', 2), M('month', 1)], prevLabel: 'the month before' };
    case 'quarter': return { cur: [M('quarter', 0), `${M('quarter', 0)} + interval '3 months'`], prev: [M('quarter', 1), M('quarter', 0)], prevLabel: 'last quarter' };
    case 'last_quarter': return { cur: [M('quarter', 1), M('quarter', 0)], prev: [M('quarter', 2), M('quarter', 1)], prevLabel: 'the quarter before' };
    case 'year': return { cur: [M('year', 0), `${M('year', 0)} + interval '1 year'`], prev: [M('year', 1), M('year', 0)], prevLabel: 'last year' };
    case 'month':
    default: return { cur: [M('month', 0), `${M('month', 0)} + interval '1 month'`], prev: [M('month', 1), M('month', 0)], prevLabel: 'last month' };
  }
}

// One side of the statement for one window.
async function sideFor(from, to) {
  // Revenue is PRE-TAX throughout. HST collected is not income — it's the CRA's
  // money passing through, and counting it would inflate every line below.
  const rev = (await query(`
    SELECT COALESCE(SUM(o.total - COALESCE(o.hst,0)),0) AS revenue,
           COALESCE(SUM(COALESCE(o.discount,0)),0)      AS discounts,
           COUNT(*)                                     AS orders
      FROM orders o
     WHERE ${SALE('o')} AND ${LT('o.created_at')} >= ${from} AND ${LT('o.created_at')} < ${to}`)).rows[0] || {};

  // COGS over lines whose cost is known, plus how much of the sale that covers —
  // an unknown cost must never be read as pure profit, so it is reported instead.
  const cogs = (await query(`
    SELECT COALESCE(SUM(COALESCE(oi.cost, p.cost)),0)                          AS cogs,
           COALESCE(SUM(oi.price),0)                                           AS sold,
           COALESCE(SUM(oi.price) FILTER (WHERE COALESCE(oi.cost, p.cost) IS NOT NULL),0) AS costed,
           COUNT(*) FILTER (WHERE COALESCE(oi.cost, p.cost) IS NULL AND oi.sku IS NOT NULL) AS missing
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE ${SALE('o')} AND COALESCE(oi.kind,'unit') = 'unit'
       AND ${LT('o.created_at')} >= ${from} AND ${LT('o.created_at')} < ${to}`)).rows[0] || {};

  // Operating expenses, by category, PRE-TAX: the recoverable HST is not a cost,
  // it comes back as an input tax credit. Rows with no tax answered yet are
  // counted at what was charged, and flagged, because that overstates them.
  let byCategory = [];
  let unreviewed = 0;
  try {
    const rows = (await query(`
      SELECT COALESCE(NULLIF(category,''),'Uncategorised') AS category,
             COALESCE(SUM(amount),0) AS amount,
             COUNT(*) FILTER (WHERE tax IS NULL) AS unreviewed
        FROM expenses
       WHERE incurred_on >= ${from} AND incurred_on < ${to}
       GROUP BY 1 ORDER BY amount DESC`)).rows;
    byCategory = rows.map((r) => ({ category: r.category, amount: round2(n(r.amount)), unreviewed: n(r.unreviewed) }));
    unreviewed = rows.reduce((a, r) => a + n(r.unreviewed), 0);
  } catch { /* no expenses table yet */ }

  let ads = 0;
  try {
    ads = n((await query(`SELECT COALESCE(SUM(amount),0) AS a FROM ad_spend WHERE spent_on >= ${from} AND spent_on < ${to}`)).rows[0]?.a);
  } catch { /* no ad_spend table yet */ }

  let labor = 0;
  try { labor = (await laborCostBetween(from, to)).total; } catch { /* no payroll data */ }

  const revenue = round2(n(rev.revenue));
  const cogsTotal = round2(n(cogs.cogs));
  const grossProfit = round2(revenue - cogsTotal);
  const opexCategories = round2(byCategory.reduce((a, c) => a + c.amount, 0));
  const opex = round2(opexCategories + ads + labor);
  const sold = n(cogs.sold);

  return {
    revenue,
    discounts: round2(n(rev.discounts)),
    orders: n(rev.orders),
    cogs: cogsTotal,
    grossProfit,
    grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    // What share of the sold value actually has a cost behind it. A gross margin
    // computed over 40% cost coverage is a guess wearing a percentage sign.
    costCoveragePct: sold > 0 ? (n(cogs.costed) / sold) * 100 : 0,
    unitsMissingCost: n(cogs.missing),
    byCategory,
    expenses: opexCategories,
    ads: round2(ads),
    labor: round2(labor),
    opex,
    netProfit: round2(grossProfit - opex),
    netMarginPct: revenue > 0 ? ((grossProfit - opex) / revenue) * 100 : 0,
    unreviewedExpenseRows: unreviewed
  };
}

export async function profitAndLoss(period = 'month') {
  if (!hasDb()) return null;
  if (!PNL_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = windowFor(period);
  const [current, previous] = await Promise.all([sideFor(...w.cur), sideFor(...w.prev)]);

  // The dates the statement actually covers, so a printed copy says what it is.
  const range = (await query(
    `SELECT to_char(${w.cur[0]}, 'YYYY-MM-DD') AS from_d,
            to_char(${w.cur[1]} - interval '1 day', 'YYYY-MM-DD') AS to_d`
  )).rows[0] || {};

  return {
    period,
    label: (PNL_PERIODS.find((p) => p.key === period) || {}).label || '',
    prevLabel: w.prevLabel,
    from: range.from_d || null,
    to: range.to_d || null,
    current,
    previous
  };
}

// The same statement as CSV, for the accountant who wants it in a spreadsheet.
export function pnlCsv(pnl) {
  if (!pnl) return '';
  const c = pnl.current;
  const money = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const rows = [
    ['Bargain Bay — Profit & Loss'],
    [`${pnl.label} · ${pnl.from} to ${pnl.to}`],
    [],
    ['Line', 'Amount (CAD)'],
    ['Revenue (ex-HST)', money(c.revenue)],
    ['Cost of goods sold', money(-c.cogs)],
    ['Gross profit', money(c.grossProfit)],
    [],
    ['Operating expenses', ''],
    ...c.byCategory.map((x) => [`  ${x.category}`, money(-x.amount)]),
    ['  Ad spend', money(-c.ads)],
    ['  Labour', money(-c.labor)],
    ['Total operating expenses', money(-c.opex)],
    [],
    ['Net profit', money(c.netProfit)]
  ];
  return rows
    .map((r) => r.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n');
}
