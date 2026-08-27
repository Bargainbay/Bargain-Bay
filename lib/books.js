// The records an accountant is handed, and the exports they ask for.
//
// "Adequate for an accountant to work through" means one place holding every
// money movement in a period, each row traceable back to a document, and each
// section downloadable. This is that — deliberately a RECORDS pack, not a set of
// financial statements.
//
// WHAT THIS IS NOT, and the page says so: a general ledger with double entry, a
// trial balance, or a balance sheet. Those need a chart of accounts, opening
// balances and owner equity, none of which this system tracks — and producing a
// balance sheet that silently omits equity would be worse than not producing one.
// See the note rendered on the page.
import { query, hasDb } from './db';
import { round2 } from './constants';

const TZ = "AT TIME ZONE 'America/Toronto'";
const NOW = `(now() ${TZ})`;
const LT = (col) => `(${col} ${TZ})`;
const n = (v) => Number(v || 0);

// Same predicate as the dashboard and the P&L. Three copies now, deliberately:
// each surface would be worse if it silently disagreed with the others, so if
// one changes they all change.
const SALE = (t = 'o') => `(
  ${t}.status IN ('confirmed','ready','out_for_delivery','delivered')
  OR (${t}.status = 'pending_payment'
      AND EXISTS (SELECT 1 FROM invoices bi
                   WHERE bi.order_id = ${t}.id AND bi.status IN ('open','partial')))
)`;

export const BOOK_PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'year', label: 'This year' }
];

function windowFor(period) {
  const M = (unit, back = 0) => `(date_trunc('${unit}',${NOW}) - interval '${back} ${unit}')`;
  switch (period) {
    case 'last_month': return [M('month', 1), M('month', 0)];
    case 'quarter': return [M('quarter', 0), `${M('quarter', 0)} + interval '3 months'`];
    case 'last_quarter': return [M('quarter', 1), M('quarter', 0)];
    case 'year': return [M('year', 0), `${M('year', 0)} + interval '1 year'`];
    case 'month':
    default: return [M('month', 0), `${M('month', 0)} + interval '1 month'`];
  }
}

// Each section is one query and one CSV. Named so a folder of downloads still
// makes sense a year later.
export const BOOK_SECTIONS = {
  sales: 'Sales (invoices raised)',
  payments: 'Payments received',
  refunds: 'Refunds issued',
  expenses: 'Operating expenses',
  purchases: 'Stock purchase invoices'
};

async function rowsFor(section, from, to) {
  const safe = async (sql, args = []) => {
    try { return (await query(sql, args)).rows; } catch { return []; }
  };
  switch (section) {
    case 'sales':
      return safe(`
        SELECT i.number, ${LT('i.created_at')}::date AS date, i.name, i.email,
               i.subtotal, i.hst, i.total, i.status, i.payment_method,
               i.created_by_name AS raised_by, o.order_number
          FROM invoices i
          LEFT JOIN orders o ON o.id = i.order_id
         WHERE i.status <> 'void' AND ${LT('i.created_at')} >= ${from} AND ${LT('i.created_at')} < ${to}
         ORDER BY i.created_at, i.id`);
    case 'payments':
      return safe(`
        SELECT i.number AS invoice, ${LT('p.paid_at')}::date AS date,
               i.name AS customer, p.amount, p.method, p.note
          FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE ${LT('p.paid_at')} >= ${from} AND ${LT('p.paid_at')} < ${to}
         ORDER BY p.paid_at, p.id`);
    case 'refunds':
      return safe(`
        SELECT i.number AS invoice, ${LT('r.created_at')}::date AS date,
               i.name AS customer, r.amount, r.restocking_fee, r.restocking_pct,
               r.kind, r.reason, r.created_by
          FROM invoice_refunds r JOIN invoices i ON i.id = r.invoice_id
         WHERE ${LT('r.created_at')} >= ${from} AND ${LT('r.created_at')} < ${to}
         ORDER BY r.created_at, r.id`);
    case 'expenses':
      return safe(`
        SELECT incurred_on AS date, vendor, category, amount, tax,
               (amount + COALESCE(tax,0)) AS total, note, source
          FROM expenses
         WHERE incurred_on >= ${from} AND incurred_on < ${to}
         ORDER BY incurred_on, id`);
    case 'purchases':
      return safe(`
        SELECT invoice_date AS date, vendor, invoice_number, subtotal, tax, total, units, note
          FROM purchase_invoices
         WHERE invoice_date >= ${from} AND invoice_date < ${to}
         ORDER BY invoice_date, id`);
    default:
      return [];
  }
}

// Counts and totals per section, for the page. Cheap enough to do all five.
export async function booksSummary(period = 'month') {
  if (!hasDb()) return null;
  if (!BOOK_PERIODS.some((p) => p.key === period)) period = 'month';
  const [from, to] = windowFor(period);

  const range = (await query(
    `SELECT to_char(${from}, 'YYYY-MM-DD') AS from_d,
            to_char(${to} - interval '1 day', 'YYYY-MM-DD') AS to_d`
  )).rows[0] || {};

  const sections = {};
  for (const key of Object.keys(BOOK_SECTIONS)) {
    // eslint-disable-next-line no-await-in-loop -- five small queries, once per load
    const rows = await rowsFor(key, from, to);
    const amountKey = key === 'expenses' ? 'total' : (key === 'sales' || key === 'purchases' ? 'total' : 'amount');
    sections[key] = {
      label: BOOK_SECTIONS[key],
      count: rows.length,
      total: round2(rows.reduce((a, r) => a + n(r[amountKey]), 0))
    };
  }

  // The one number an accountant checks first: does the money the app says came
  // in match what the sales records add up to.
  const collected = round2(n((await query(
    `SELECT COALESCE(SUM(p.amount),0) AS t FROM invoice_payments p
      WHERE ${LT('p.paid_at')} >= ${from} AND ${LT('p.paid_at')} < ${to}`
  ).catch(() => ({ rows: [{}] })))?.rows?.[0]?.t));

  const orders = (await query(`
    SELECT COUNT(*) AS c, COALESCE(SUM(o.total - COALESCE(o.hst,0)),0) AS revenue,
           COALESCE(SUM(COALESCE(o.hst,0)),0) AS hst
      FROM orders o
     WHERE ${SALE('o')} AND ${LT('o.created_at')} >= ${from} AND ${LT('o.created_at')} < ${to}`)).rows[0] || {};

  return {
    period,
    label: (BOOK_PERIODS.find((p) => p.key === period) || {}).label || '',
    from: range.from_d || null,
    to: range.to_d || null,
    sections,
    revenue: round2(n(orders.revenue)),
    hstCharged: round2(n(orders.hst)),
    orders: n(orders.c),
    collected
  };
}

// One section as CSV. Headers come from the row shape so a column added to a
// query shows up in the download without anyone remembering to add it here.
export async function sectionCsv(section, period = 'month') {
  if (!hasDb() || !BOOK_SECTIONS[section]) return { name: 'empty.csv', csv: '' };
  if (!BOOK_PERIODS.some((p) => p.key === period)) period = 'month';
  const [from, to] = windowFor(period);
  const range = (await query(
    `SELECT to_char(${from}, 'YYYY-MM-DD') AS f, to_char(${to} - interval '1 day', 'YYYY-MM-DD') AS t`
  )).rows[0] || {};
  const rows = await rowsFor(section, from, to);

  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))
  ].join('\n');

  return { name: `bargain-bay-${section}-${range.f}-to-${range.t}.csv`, csv, count: rows.length };
}
