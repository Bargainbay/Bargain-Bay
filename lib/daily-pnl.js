// Did we make or lose money TODAY, as a whole operation.
//
// Built from pieces that already exist rather than a fourth opinion:
//   + product profit   what the units sold that day made over their cost
//   + delivery income  what deliveries brought in (dispatch's own figure)
//   - delivery costs   driver pay, driver hours, truck day rate, fuel (dispatch)
//   - staff wages      clock-in hours x rate (lib/team-clock.js)
//   - overhead         the cost list, each bill spread over the days it covers
//
// The delivery lines come straight from dispatch-money's profitReport, so this
// page and the Profit tab on the dispatch board agree to the cent.
//
// WHAT IS DELIBERATELY NOT HERE: the `expenses` ledger (bank/QuickBooks feed).
// It holds the same rent and hydro the cost list does; adding both would count
// every bill twice. The cost list is the day-by-day view; the P&L report stays
// the accountant's.
import { query, hasDb } from './db';
import { round2, torontoToday } from './constants';
import { profitReport } from './dispatch-money';
import { staffLabourByDay } from './team-clock';
import { dailyShare, daysBetween } from './daily-cost-math';

const n = (v) => Number(v || 0);
const TZ = "AT TIME ZONE 'America/Toronto'";
// Same predicate as lib/pnl.js / lib/analytics.js -- see CLAUDE.md "SALE".
const SALE = `(
  o.status IN ('confirmed','ready','out_for_delivery','delivered')
  OR (o.status = 'pending_payment'
      AND EXISTS (SELECT 1 FROM invoices bi WHERE bi.order_id = o.id AND bi.status IN ('open','partial')))
)`;

export const MAX_DAYS = 92;

export async function listCosts({ includeInactive = false } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, name, category, amount, frequency, starts_on::text AS starts_on,
            ends_on::text AS ends_on, note, active
       FROM recurring_costs ${includeInactive ? '' : 'WHERE active = true'}
      ORDER BY active DESC, category, name`);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

async function productProfitByDay(from, to) {
  const lines = await query(
    `SELECT (o.created_at ${TZ})::date::text AS day,
            COALESCE(SUM(oi.price - COALESCE(oi.cost, p.cost)) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND COALESCE(oi.cost, p.cost) IS NOT NULL), 0) AS profit,
            COALESCE(SUM(oi.price) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit'), 0) AS sold,
            COALESCE(SUM(oi.price) FILTER (WHERE oi.kind IN ('discount','trade_in')), 0) AS credits,
            COUNT(*) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND oi.sku IS NOT NULL AND COALESCE(oi.cost, p.cost) IS NULL)::int AS missing_cost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.sku = oi.sku
      WHERE ${SALE} AND oi.vendor_id IS NULL AND (o.created_at ${TZ})::date BETWEEN $1::date AND $2::date
      GROUP BY 1`, [from, to]);
  // Coupon discounts that live on the order itself (storefront checkout). An
  // invoice-raised order carries its discount as a line instead and has this
  // zeroed, so the two cannot both apply.
  const coupons = await query(
    `SELECT (o.created_at ${TZ})::date::text AS day, COALESCE(SUM(COALESCE(o.discount,0)),0) AS d
       FROM orders o WHERE ${SALE} AND (o.created_at ${TZ})::date BETWEEN $1::date AND $2::date GROUP BY 1`, [from, to]);
  const cMap = new Map(coupons.rows.map((r) => [r.day, n(r.d)]));
  return new Map(lines.rows.map((r) => [r.day, {
    profit: round2(n(r.profit) + n(r.credits) - (cMap.get(r.day) || 0)),
    missingCost: r.missing_cost
  }]));
}

// What the marketplace earned us each day: commission and fees on sellers' sales, recognised when the
// sale settles. Soft-fails to nothing — the marketplace tables may not exist.
async function marketplaceIncomeByDay(from, to) {
  try {
    const { rows } = await query(
      `SELECT (at ${TZ})::date::text AS day,
              COALESCE(-SUM(amount_cents) FILTER (WHERE kind IN ('commission','delivery_service_fee','insurance')), 0) / 100.0 AS income
         FROM vendor_ledger WHERE (at ${TZ})::date BETWEEN $1::date AND $2::date GROUP BY 1`, [from, to]);
    return new Map(rows.map((r) => [r.day, round2(n(r.income))]));
  } catch { return new Map(); }
}

export async function dailyPnl({ from, to } = {}) {
  const today = torontoToday();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : today;
  let start = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : end;
  let days = daysBetween(start, end);
  if (days.length > MAX_DAYS) { days = days.slice(-MAX_DAYS); start = days[0]; }
  if (!hasDb()) return { from: start, to: end, today, rows: [], totals: {}, warnings: [] };

  const [product, delivery, staff, costs, mktIncome] = await Promise.all([
    productProfitByDay(start, end),
    profitReport({ from: start, to: end, group: 'day' }),
    staffLabourByDay(start, end),
    listCosts(),
    marketplaceIncomeByDay(start, end)
  ]);
  const del = new Map(delivery.buckets.map((b) => [b.key, b]));

  const rows = days.map((day) => {
    const p = product.get(day) || { profit: 0, missingCost: 0 };
    const d = del.get(day) || {};
    const s = staff.days.get(day) || { cost: 0, hours: 0 };
    const overheadLines = costs
      .map((c) => ({ id: c.id, name: c.name, category: c.category, amount: dailyShare(c, day) }))
      .filter((l) => l.amount > 0);
    const overhead = round2(overheadLines.reduce((a, l) => a + l.amount, 0));
    const deliveryIncome = round2(n(d.revenue));
    const deliveryCost = round2(n(d.cost));
    const marketplaceIncome = mktIncome.get(day) || 0;
    const income = round2(p.profit + deliveryIncome + marketplaceIncome);
    const cost = round2(deliveryCost + s.cost + overhead);
    return {
      day, productProfit: p.profit, deliveryIncome, marketplaceIncome, income,
      deliveryCost,
      deliveryParts: { driverPay: n(d.driverPay), driverHours: n(d.labour), truck: n(d.truck), fuel: n(d.gas), other: n(d.otherCost) },
      staffWages: s.cost, staffHours: s.hours, overhead, overheadLines,
      cost, net: round2(income - cost),
      missingCost: p.missingCost, deliveries: d.jobs || 0
    };
  });

  const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
  const totals = {
    productProfit: sum('productProfit'), deliveryIncome: sum('deliveryIncome'), marketplaceIncome: sum('marketplaceIncome'), income: sum('income'),
    deliveryCost: sum('deliveryCost'), staffWages: sum('staffWages'), overhead: sum('overhead'),
    cost: sum('cost'), net: sum('net'), staffHours: sum('staffHours'),
    daysMade: rows.filter((r) => r.net > 0).length, daysLost: rows.filter((r) => r.net < 0).length
  };

  // Every way these figures can be short, named instead of folded into a total.
  const warnings = [];
  const missingCost = rows.reduce((a, r) => a + r.missingCost, 0);
  if (missingCost) warnings.push(`${missingCost} unit${missingCost === 1 ? '' : 's'} sold with no cost on file are counted as zero profit, not as pure profit.`);
  if (staff.open) warnings.push(`${staff.open} staff shift${staff.open === 1 ? ' is' : 's are'} still clocked in, so wages for them are not counted yet.`);
  if (staff.unpriced - staff.open > 0) warnings.push(`${staff.unpriced - staff.open} staff shift(s) ran longer than the sanity limit and are left out until corrected.`);
  if (staff.noRate) warnings.push(`${staff.noRate} staff shift(s) belong to people with no hourly rate, so they cost nothing here. Set their rate on the Team clock page.`);
  if (delivery.totals.unpricedRevenue) warnings.push(`${delivery.totals.unpricedRevenue} completed delivery stop(s) have no charge set, so no income is counted for them.`);
  if (delivery.totals.unpricedShifts) warnings.push(`${delivery.totals.unpricedShifts} driver shift(s) were never closed and are left out of driver hours.`);
  if (!costs.length) warnings.push('The cost list is empty, so overhead (rent, utilities, insurance...) is $0. Add them under Costs.');

  return { from: start, to: end, today, rows, totals, warnings };
}
