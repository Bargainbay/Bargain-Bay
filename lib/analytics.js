// Owner CRM / sales-tracker dashboard data — all derived from Postgres
// (orders, order_items, users). Read-only; safe no-op without a database.
import { query, hasDb } from './db';
import { loadUnits } from './inventory';

// Orders that count as real sales (exclude abandoned + cancelled).
const SALE = "('confirmed','ready','out_for_delivery','delivered')";

// Headline KPIs + chart series + leaderboards for the dashboard home.
export async function dashboardData() {
  if (!hasDb()) return null;

  const kpi = (await query(`
    SELECT
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ${SALE})                                   AS revenue,
      (SELECT COUNT(*)              FROM orders WHERE status IN ${SALE})                                     AS orders,
      (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status IN ${SALE})      AS units_sold,
      (SELECT COUNT(*) FROM users)                                                                          AS customers,
      (SELECT COUNT(*) FROM users WHERE role='member' AND member_status='approved')                         AS members,
      (SELECT COUNT(*) FROM users WHERE member_status='pending')                                            AS pending_members,
      (SELECT COUNT(*) FROM orders WHERE status='pending_payment')                                          AS pending_orders
  `)).rows[0] || {};

  const revenue = Number(kpi.revenue || 0);
  const orders = Number(kpi.orders || 0);

  const revRows = (await query(`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders
      FROM orders WHERE status IN ${SALE}
     GROUP BY 1 ORDER BY 1 DESC LIMIT 12
  `)).rows;
  const revenueByMonth = revRows
    .map((r) => ({ month: r.month, revenue: Number(r.revenue), orders: Number(r.orders) }))
    .reverse();

  const topRows = (await query(`
    SELECT COALESCE(NULLIF(name,''), email) AS name, lower(email) AS email,
           COUNT(*) AS orders, COALESCE(SUM(total),0) AS spent
      FROM orders WHERE status IN ${SALE}
     GROUP BY COALESCE(NULLIF(name,''), email), lower(email)
     ORDER BY spent DESC LIMIT 8
  `)).rows;
  const topCustomers = topRows.map((r) => ({ name: r.name, email: r.email, orders: Number(r.orders), spent: Number(r.spent) }));

  const statusBreakdown = (await query(
    `SELECT status, COUNT(*) AS c, COALESCE(SUM(total),0) AS total FROM orders GROUP BY status ORDER BY c DESC`
  )).rows.map((r) => ({ status: r.status, count: Number(r.c), total: Number(r.total) }));

  const recentOrders = (await query(`
    SELECT order_number, name, email, total, status, created_at
      FROM orders ORDER BY created_at DESC LIMIT 10
  `)).rows.map((r) => ({
    orderNumber: r.order_number, name: r.name, email: r.email,
    total: Number(r.total), status: r.status, createdAt: r.created_at ? r.created_at.toISOString() : null
  }));

  return {
    kpis: {
      revenue, orders, unitsSold: Number(kpi.units_sold || 0),
      avgOrder: orders ? revenue / orders : 0,
      customers: Number(kpi.customers || 0), members: Number(kpi.members || 0),
      pendingMembers: Number(kpi.pending_members || 0), pendingOrders: Number(kpi.pending_orders || 0)
    },
    revenueByMonth, topCustomers, statusBreakdown, recentOrders
  };
}

// Inventory financials from live inventory (in-stock units). `cost` is the
// tracker's Total Cost; populated by the inventory sync.
export async function inventoryFinancials() {
  const units = (await loadUnits()).filter((u) => u && u.id);
  let cost = 0, suggested = 0, retail = 0, withCost = 0;
  const cats = new Map();
  for (const u of units) {
    const c = Number(u.cost) || 0;
    const p = Number(u.price) || 0;
    const r = Number(u.compareAt) || 0;
    cost += c; suggested += p; retail += r;
    if (c > 0) withCost++;
    const key = u.category || 'Other';
    const b = cats.get(key) || { category: key, units: 0, cost: 0, suggested: 0 };
    b.units++; b.cost += c; b.suggested += p;
    cats.set(key, b);
  }
  const potentialProfit = suggested - cost;
  return {
    units: units.length,
    unitsWithCost: withCost,
    inventoryCost: cost,
    suggestedValue: suggested,
    retailValue: retail,
    potentialProfit,
    marginPct: suggested > 0 ? (potentialProfit / suggested) * 100 : 0,
    byCategory: [...cats.values()]
      .map((b) => ({ ...b, profit: b.suggested - b.cost, margin: b.suggested > 0 ? ((b.suggested - b.cost) / b.suggested) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit)
  };
}

// ── Revenue dashboard (period-aware) ────────────────────────────────────────
// Everything keyed to a selected time window with a comparison against the
// previous comparable period. All bucketing is in America/Toronto local time so
// a late-evening sale lands on the right day. `period` comes from a fixed
// allowlist (never user free-text), so the SQL window expressions below are safe
// to template.
export const DASH_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' }
];
const TZ = "AT TIME ZONE 'America/Toronto'";
const NOW = `(now() ${TZ})`;
const LT = (col) => `(${col} ${TZ})`; // local-time expression for a timestamp col

// SQL window expressions for the current + previous comparable period, plus the
// chart bucket unit/label format. `prev` is null for "all time".
function dashWindow(period) {
  switch (period) {
    case 'today': return {
      cur: [`date_trunc('day',${NOW})`, `date_trunc('day',${NOW}) + interval '1 day'`],
      prev: [`date_trunc('day',${NOW}) - interval '1 day'`, `date_trunc('day',${NOW})`],
      unit: 'hour', fmt: 'HH24:00', prevLabel: 'yesterday' };
    case 'week': return {
      cur: [`date_trunc('day',${NOW}) - interval '6 days'`, `date_trunc('day',${NOW}) + interval '1 day'`],
      prev: [`date_trunc('day',${NOW}) - interval '13 days'`, `date_trunc('day',${NOW}) - interval '6 days'`],
      unit: 'day', fmt: 'Dy DD', prevLabel: 'previous 7 days' };
    case 'last_month': return {
      cur: [`date_trunc('month',${NOW}) - interval '1 month'`, `date_trunc('month',${NOW})`],
      prev: [`date_trunc('month',${NOW}) - interval '2 months'`, `date_trunc('month',${NOW}) - interval '1 month'`],
      unit: 'day', fmt: 'DD', prevLabel: 'month before' };
    case 'year': return {
      cur: [`date_trunc('year',${NOW})`, `date_trunc('year',${NOW}) + interval '1 year'`],
      prev: [`date_trunc('year',${NOW}) - interval '1 year'`, `date_trunc('year',${NOW})`],
      unit: 'month', fmt: 'Mon', prevLabel: 'last year' };
    case 'all': return {
      cur: [`COALESCE((SELECT date_trunc('month', min(${LT('created_at')})) FROM orders WHERE status IN ${SALE}), date_trunc('year',${NOW}))`,
            `date_trunc('month',${NOW}) + interval '1 month'`],
      prev: null, unit: 'month', fmt: 'Mon YY', prevLabel: null };
    case 'month':
    default: return {
      cur: [`date_trunc('month',${NOW})`, `date_trunc('month',${NOW}) + interval '1 month'`],
      prev: [`date_trunc('month',${NOW}) - interval '1 month'`, `date_trunc('month',${NOW})`],
      unit: 'day', fmt: 'DD', prevLabel: 'last month' };
  }
}

const num = (v) => Number(v || 0);
// % change vs the comparison period; null when there's nothing to compare to.
function delta(cur, prev, hasPrev) {
  if (!hasPrev) return null;
  if (prev === 0) return cur > 0 ? { isNew: true, dir: 'up' } : { pct: 0, dir: 'flat' };
  const pct = ((cur - prev) / prev) * 100;
  return { pct, dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' };
}

export async function revenueDashboard(period = 'month') {
  if (!hasDb()) return null;
  if (!DASH_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = dashWindow(period);
  const [cs, ce] = w.cur;
  const hasPrev = !!w.prev;
  const [ps, pe] = w.prev || ['', ''];
  const inCur = (lt) => `${lt} >= ${cs} AND ${lt} < ${ce}`;
  const inPrev = (lt) => `${lt} >= ${ps} AND ${lt} < ${pe}`;

  // Revenue + order count, current vs previous window.
  const ro = (await query(`
    SELECT
      COALESCE(SUM(total) FILTER (WHERE ${inCur('lt')}),0) AS rev,
      COUNT(*)            FILTER (WHERE ${inCur('lt')})     AS ord
      ${hasPrev ? `, COALESCE(SUM(total) FILTER (WHERE ${inPrev('lt')}),0) AS prev_rev,
                     COUNT(*) FILTER (WHERE ${inPrev('lt')}) AS prev_ord`
                : `, 0 AS prev_rev, 0 AS prev_ord`}
    FROM (SELECT total, ${LT('created_at')} AS lt FROM orders WHERE status IN ${SALE}) o
  `)).rows[0] || {};

  // Units sold + realized item margin (oi.price vs products.cost), cur vs prev.
  const up = (await query(`
    SELECT
      COUNT(*)            FILTER (WHERE ${inCur('lt')}) AS units,
      COALESCE(SUM(price) FILTER (WHERE ${inCur('lt')}),0) AS sold_value,
      COALESCE(SUM(cost)  FILTER (WHERE ${inCur('lt')}),0) AS cost,
      COUNT(cost)         FILTER (WHERE ${inCur('lt')}) AS units_with_cost
      ${hasPrev ? `, COALESCE(SUM(price) FILTER (WHERE ${inPrev('lt')}),0) AS prev_sold,
                     COALESCE(SUM(cost)  FILTER (WHERE ${inPrev('lt')}),0) AS prev_cost`
                : `, 0 AS prev_sold, 0 AS prev_cost`}
    FROM (
      SELECT oi.price, p.cost, ${LT('o.created_at')} AS lt
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.sku = oi.sku
       WHERE o.status IN ${SALE}
    ) li
  `)).rows[0] || {};

  // Continuous trend buckets — generate_series fills empty hours/days/months so
  // the chart always has context (never a single full-height bar).
  const series = (await query(`
    SELECT to_char(g, '${w.fmt}') AS label,
           COALESCE(SUM(o.total),0) AS revenue,
           COUNT(o.id) AS orders
      FROM generate_series(${cs}, ${ce} - interval '1 ${w.unit}', interval '1 ${w.unit}') g
      LEFT JOIN orders o
        ON o.status IN ${SALE}
       AND date_trunc('${w.unit}', ${LT('o.created_at')}) = g
     GROUP BY g ORDER BY g
  `)).rows.map((r) => ({ label: r.label, revenue: num(r.revenue), orders: num(r.orders) }));

  // What's selling, scoped to the window.
  const byCategory = (await query(`
    SELECT COALESCE(p.category,'Other') AS category, COUNT(*) AS units,
           COALESCE(SUM(oi.price),0) AS revenue, COALESCE(SUM(p.cost),0) AS cost
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE o.status IN ${SALE} AND ${inCur(LT('o.created_at'))}
     GROUP BY 1 ORDER BY revenue DESC LIMIT 12
  `)).rows.map((r) => ({ category: r.category, units: num(r.units), revenue: num(r.revenue), cost: num(r.cost), profit: num(r.revenue) - num(r.cost) }));

  const topModels = (await query(`
    SELECT oi.title, COUNT(*) AS qty, COALESCE(SUM(oi.price),0) AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN ${SALE} AND ${inCur(LT('o.created_at'))}
     GROUP BY oi.title ORDER BY qty DESC, revenue DESC LIMIT 8
  `)).rows.map((r) => ({ title: r.title, qty: num(r.qty), revenue: num(r.revenue) }));

  const topCustomers = (await query(`
    SELECT COALESCE(NULLIF(name,''), email) AS name, lower(email) AS email,
           COUNT(*) AS orders, COALESCE(SUM(total),0) AS spent
      FROM orders
     WHERE status IN ${SALE} AND ${inCur(LT('created_at'))}
     GROUP BY COALESCE(NULLIF(name,''), email), lower(email)
     ORDER BY spent DESC LIMIT 8
  `)).rows.map((r) => ({ name: r.name, email: r.email, orders: num(r.orders), spent: num(r.spent) }));

  const recentOrders = (await query(`
    SELECT order_number, name, total, status, created_at
      FROM orders ORDER BY created_at DESC LIMIT 8
  `)).rows.map((r) => ({ orderNumber: r.order_number, name: r.name, total: num(r.total), status: r.status, createdAt: r.created_at ? r.created_at.toISOString() : null }));

  // Pipeline = current outstanding money, independent of the date filter. Each
  // table self-provisions elsewhere; tolerate it not existing yet.
  let invoicesOpen = { total: 0, count: 0, overdueTotal: 0, overdueCount: 0 };
  let quotesOpen = { total: 0, count: 0 };
  try {
    const i = (await query(`
      SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count,
             COALESCE(SUM(total) FILTER (WHERE due_date < now()),0) AS overdue_total,
             COUNT(*) FILTER (WHERE due_date < now()) AS overdue_count
        FROM invoices WHERE status = 'open'`)).rows[0] || {};
    invoicesOpen = { total: num(i.total), count: num(i.count), overdueTotal: num(i.overdue_total), overdueCount: num(i.overdue_count) };
  } catch { /* invoices table not created yet */ }
  try {
    const q = (await query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM quotes WHERE status IN ('open','accepted')`)).rows[0] || {};
    quotesOpen = { total: num(q.total), count: num(q.count) };
  } catch { /* quotes table not created yet */ }

  const rev = num(ro.rev), ord = num(ro.ord), prevRev = num(ro.prev_rev), prevOrd = num(ro.prev_ord);
  const soldValue = num(up.sold_value), cost = num(up.cost);
  const prevSold = num(up.prev_sold), prevCost = num(up.prev_cost);
  const profit = soldValue - cost, prevProfit = prevSold - prevCost;
  const units = num(up.units), avg = ord ? rev / ord : 0, prevAvg = prevOrd ? prevRev / prevOrd : 0;

  return {
    period, prevLabel: w.prevLabel, unit: w.unit, hasPrev,
    kpis: {
      revenue: rev, revenueDelta: delta(rev, prevRev, hasPrev),
      orders: ord, ordersDelta: delta(ord, prevOrd, hasPrev),
      units,
      avgOrder: avg, avgDelta: delta(avg, prevAvg, hasPrev),
      profit, profitDelta: delta(profit, prevProfit, hasPrev),
      marginPct: soldValue > 0 ? (profit / soldValue) * 100 : 0,
      soldValue, unitsWithCost: num(up.units_with_cost)
    },
    pipeline: { invoices: invoicesOpen, quotes: quotesOpen },
    series, byCategory, topModels, topCustomers, recentOrders
  };
}

// Consolidated reports (Reports tab): period revenue, realized margin, sales by
// category, top models, salvage, monthly trend, and the inventory snapshot.
export async function reportsData() {
  if (!hasDb()) return null;

  const per = (await query(`
    SELECT
      COALESCE(SUM(total) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',now())),0) AS this_month,
      COALESCE(SUM(total) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',now()) - interval '1 month'),0) AS last_month,
      COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('year',now())),0) AS ytd,
      COALESCE(SUM(total),0) AS all_time,
      COUNT(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',now())) AS this_month_orders
      FROM orders WHERE status IN ${SALE}
  `)).rows[0] || {};

  const marg = (await query(`
    SELECT COALESCE(SUM(oi.price),0) AS sold_value, COALESCE(SUM(p.cost),0) AS cost,
           COUNT(*) AS units, COUNT(p.cost) AS units_with_cost
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      LEFT JOIN products p ON p.sku=oi.sku
     WHERE o.status IN ${SALE}
  `)).rows[0] || {};

  const byCategory = (await query(`
    SELECT COALESCE(p.category,'Other') AS category, COUNT(*) AS units,
           COALESCE(SUM(oi.price),0) AS revenue, COALESCE(SUM(p.cost),0) AS cost
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      LEFT JOIN products p ON p.sku=oi.sku
     WHERE o.status IN ${SALE}
     GROUP BY 1 ORDER BY revenue DESC
  `)).rows.map((r) => ({ category: r.category, units: Number(r.units), revenue: Number(r.revenue), cost: Number(r.cost), profit: Number(r.revenue) - Number(r.cost) }));

  const topModels = (await query(`
    SELECT oi.title, COUNT(*) AS qty, COALESCE(SUM(oi.price),0) AS revenue
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.status IN ${SALE}
     GROUP BY oi.title ORDER BY qty DESC, revenue DESC LIMIT 10
  `)).rows.map((r) => ({ title: r.title, qty: Number(r.qty), revenue: Number(r.revenue) }));

  const revenueByMonth = (await query(`
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, COALESCE(SUM(total),0) AS revenue
      FROM orders WHERE status IN ${SALE} GROUP BY 1 ORDER BY 1 DESC LIMIT 12
  `)).rows.map((r) => ({ month: r.month, revenue: Number(r.revenue) })).reverse();

  let salvage = { disposed: 0, revenue: 0, cost: 0 };
  try {
    const s = (await query(`SELECT COUNT(*) AS disposed, COALESCE(SUM(sale_price),0) AS revenue, COALESCE(SUM(cost),0) AS cost FROM salvage_units WHERE status='disposed'`)).rows[0] || {};
    salvage = { disposed: Number(s.disposed), revenue: Number(s.revenue), cost: Number(s.cost) };
  } catch { /* salvage table not migrated yet */ }

  const soldValue = Number(marg.sold_value), realizedCost = Number(marg.cost);
  return {
    revenue: {
      thisMonth: Number(per.this_month), lastMonth: Number(per.last_month),
      ytd: Number(per.ytd), allTime: Number(per.all_time), thisMonthOrders: Number(per.this_month_orders)
    },
    realized: {
      soldValue, cost: realizedCost, profit: soldValue - realizedCost,
      marginPct: soldValue > 0 ? ((soldValue - realizedCost) / soldValue) * 100 : 0,
      units: Number(marg.units), unitsWithCost: Number(marg.units_with_cost)
    },
    byCategory, topModels, revenueByMonth, salvage,
    inventory: await inventoryFinancials()
  };
}

// Lightweight contact list for autofill (name/email/phone only).
export async function customerContacts() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT name, email, phone FROM users WHERE email IS NOT NULL ORDER BY created_at DESC LIMIT 1000`
  );
  return rows.map((r) => ({ name: r.name || '', email: r.email || '', phone: r.phone || '' }));
}

// Full customer database: every registered user with their purchase rollups.
export async function customerList() {
  if (!hasDb()) return [];
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.member_status, u.business_name, u.created_at,
           COUNT(o.id)       FILTER (WHERE o.status IN ${SALE}) AS orders,
           COALESCE(SUM(o.total) FILTER (WHERE o.status IN ${SALE}), 0) AS spent,
           MAX(o.created_at) FILTER (WHERE o.status IN ${SALE}) AS last_order
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
     GROUP BY u.id
     ORDER BY spent DESC, u.created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role,
    memberStatus: r.member_status, business: r.business_name,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    orders: Number(r.orders), spent: Number(r.spent),
    lastOrder: r.last_order ? r.last_order.toISOString() : null
  }));
}
