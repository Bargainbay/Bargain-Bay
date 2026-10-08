// Monthly sales quotas — see db/migrations/0015_sales_quotas.sql.
import { query, hasDb } from './db';
import { repKey } from './rep-match';
import { torontoToday } from './constants';

export const firstOfMonth = (iso) => `${String(iso).slice(0, 7)}-01`;

const orNull = (v) => (v === '' || v == null ? null : v);
function amount(v, label, { integer = false } = {}) {
  v = orNull(v);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number, zero or more.`);
  if (integer && !Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  return integer ? n : Math.round(n * 100) / 100;
}

/**
 * The quota in force for each rep in `monthStart` (YYYY-MM-01): their most
 * recent row at or before it. { ok:false } when the table isn't there yet, so
 * the dashboard can say so instead of showing every rep as having no quota.
 */
export async function quotasFor(monthStart) {
  if (!hasDb()) return { ok: false, map: new Map() };
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (rep_key) rep_key, rep_name, month::text AS month,
              revenue, sales, own_revenue, own_sales
         FROM sales_quotas WHERE month <= $1::date
        ORDER BY rep_key, month DESC`, [monthStart]);
    const map = new Map(rows.map((r) => [r.rep_key, {
      name: r.rep_name, from: r.month,
      revenue: r.revenue == null ? null : Number(r.revenue),
      sales: r.sales == null ? null : Number(r.sales),
      ownRevenue: r.own_revenue == null ? null : Number(r.own_revenue),
      ownSales: r.own_sales == null ? null : Number(r.own_sales)
    }]));
    return { ok: true, map };
  } catch (e) {
    console.error('quotasFor failed', e.message);
    return { ok: false, map: new Map() };
  }
}

/**
 * Set a rep's targets from `month` onwards (default: this month). Past months
 * are history and are refused — a quota changed after the fact rewrites how
 * someone's month was judged.
 */
export async function setQuota({ rep, month, revenue, sales, ownRevenue, ownSales, by }) {
  const key = repKey(rep);
  if (!key) throw new Error('Which rep?');
  const thisMonth = firstOfMonth(torontoToday());
  const m = month ? firstOfMonth(month) : thisMonth;
  if (m < thisMonth) throw new Error('That month has already happened — quotas can only be set from this month on.');
  const vals = [
    amount(revenue, 'Revenue target'),
    amount(sales, 'Sales target', { integer: true }),
    amount(ownRevenue, 'Own-lead revenue target'),
    amount(ownSales, 'Own-lead sales target', { integer: true })
  ];
  await query(
    `INSERT INTO sales_quotas (rep_key, rep_name, month, revenue, sales, own_revenue, own_sales, set_by)
     VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8)
     ON CONFLICT (rep_key, month) DO UPDATE
       SET rep_name = EXCLUDED.rep_name, revenue = EXCLUDED.revenue, sales = EXCLUDED.sales,
           own_revenue = EXCLUDED.own_revenue, own_sales = EXCLUDED.own_sales,
           set_by = EXCLUDED.set_by, set_at = now()`,
    [key, String(rep).trim(), m, ...vals, by || null]);
  return { ok: true, month: m };
}
