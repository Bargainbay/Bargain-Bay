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

  // Revenue (PRE-TAX — what you charged, excluding HST), HST collected separately,
  // and order count, current vs previous window. Revenue excludes the HST you remit
  // to the CRA so it reads as true sales (not inflated by tax).
  const ro = (await query(`
    SELECT
      COALESCE(SUM(total - COALESCE(hst,0)) FILTER (WHERE ${inCur('lt')}),0) AS rev,
      COALESCE(SUM(COALESCE(hst,0))         FILTER (WHERE ${inCur('lt')}),0) AS hst,
      COUNT(*)                              FILTER (WHERE ${inCur('lt')})    AS ord
      ${hasPrev ? `, COALESCE(SUM(total - COALESCE(hst,0)) FILTER (WHERE ${inPrev('lt')}),0) AS prev_rev,
                     COUNT(*) FILTER (WHERE ${inPrev('lt')}) AS prev_ord`
                : `, 0 AS prev_rev, 0 AS prev_ord`}
    FROM (SELECT total, hst, ${LT('created_at')} AS lt FROM orders WHERE status IN ${SALE}) o
  `)).rows[0] || {};

  // Units sold + realized item margin (oi.price vs products.cost), cur vs prev.
  // Profit/margin are computed ONLY over lines whose cost is known (costed_value),
  // so units with no cost on file don't get counted as 100% profit. sold_value is
  // the full total, used to report cost-coverage.
  const up = (await query(`
    SELECT
      COUNT(*)            FILTER (WHERE ${inCur('lt')}) AS units,
      COALESCE(SUM(price) FILTER (WHERE ${inCur('lt')}),0) AS sold_value,
      COALESCE(SUM(price) FILTER (WHERE ${inCur('lt')} AND cost IS NOT NULL),0) AS costed_value,
      COALESCE(SUM(cost)  FILTER (WHERE ${inCur('lt')}),0) AS cost,
      COUNT(cost)         FILTER (WHERE ${inCur('lt')}) AS units_with_cost
      ${hasPrev ? `, COALESCE(SUM(price) FILTER (WHERE ${inPrev('lt')} AND cost IS NOT NULL),0) AS prev_sold,
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
           COALESCE(SUM(o.total - COALESCE(o.hst,0)),0) AS revenue,
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

  // Deals won/lost from quotes created in the period (won = accepted/converted,
  // lost = void/expired, open = still live).
  let deals = { total: 0, won: 0, lost: 0, open: 0, wonValue: 0, winRate: 0 };
  try {
    const d = (await query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status IN ('accepted','converted')) AS won,
             COUNT(*) FILTER (WHERE status IN ('void','expired')) AS lost,
             COUNT(*) FILTER (WHERE status = 'open') AS open,
             COALESCE(SUM(total) FILTER (WHERE status IN ('accepted','converted')),0) AS won_value
        FROM quotes WHERE ${inCur(LT('created_at'))}
    `)).rows[0] || {};
    const won = num(d.won), lost = num(d.lost), decided = won + lost;
    deals = { total: num(d.total), won, lost, open: num(d.open), wonValue: num(d.won_value), winRate: decided ? (won / decided) * 100 : 0 };
  } catch { /* quotes table not created yet */ }

  // Sales funnel for the period: quotes created → converted → invoices paid →
  // orders delivered. Each stage tolerant of a missing table.
  const funnel = { quotes: 0, converted: 0, invoicesPaid: 0, paidValue: 0, delivered: 0 };
  try {
    const q = (await query(`SELECT COUNT(*) AS quotes, COUNT(*) FILTER (WHERE status='converted') AS converted FROM quotes WHERE ${inCur(LT('created_at'))}`)).rows[0] || {};
    funnel.quotes = num(q.quotes); funnel.converted = num(q.converted);
  } catch { /* no quotes table */ }
  try {
    const iv = (await query(`SELECT COUNT(*) FILTER (WHERE status='paid') AS paid, COALESCE(SUM(total) FILTER (WHERE status='paid'),0) AS paid_value FROM invoices WHERE ${inCur(LT('created_at'))}`)).rows[0] || {};
    funnel.invoicesPaid = num(iv.paid); funnel.paidValue = num(iv.paid_value);
  } catch { /* no invoices table */ }
  try {
    funnel.delivered = num((await query(`SELECT COUNT(*) AS delivered FROM orders WHERE status='delivered' AND ${inCur(LT('created_at'))}`)).rows[0]?.delivered);
  } catch { /* ignore */ }

  // Per-salesperson revenue (period). Empty until orders carry a sales_rep.
  let reps = [];
  try {
    reps = (await query(`
      SELECT sales_rep AS rep, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
        FROM orders
       WHERE status IN ${SALE} AND sales_rep IS NOT NULL AND sales_rep <> '' AND ${inCur(LT('created_at'))}
       GROUP BY sales_rep ORDER BY revenue DESC`)).rows.map((r) => ({ rep: r.rep, orders: num(r.orders), revenue: num(r.revenue) }));
  } catch { /* sales_rep column not added yet */ }

  // Salvage / parts-unit revenue (all-time realized) — the one figure the old
  // Reports tab had that the dashboard didn't.
  let salvage = { disposed: 0, revenue: 0 };
  try {
    const s = (await query(`SELECT COUNT(*) AS disposed, COALESCE(SUM(sale_price),0) AS revenue FROM salvage_units WHERE status='disposed'`)).rows[0] || {};
    salvage = { disposed: num(s.disposed), revenue: num(s.revenue) };
  } catch { /* salvage_units table not created yet */ }

  const rev = num(ro.rev), ord = num(ro.ord), prevRev = num(ro.prev_rev), prevOrd = num(ro.prev_ord);
  const soldValue = num(up.sold_value), costedValue = num(up.costed_value), cost = num(up.cost);
  const prevSold = num(up.prev_sold), prevCost = num(up.prev_cost); // prev_sold is the costed value
  // Profit/margin only over sales whose cost is known, so missing-cost units
  // aren't booked as pure profit. costCoverage = % of sales $ that have a cost.
  const profit = costedValue - cost, prevProfit = prevSold - prevCost;
  const costCoverage = soldValue > 0 ? (costedValue / soldValue) * 100 : 0;
  const units = num(up.units), avg = ord ? rev / ord : 0, prevAvg = prevOrd ? prevRev / prevOrd : 0;

  return {
    period, prevLabel: w.prevLabel, unit: w.unit, hasPrev,
    kpis: {
      revenue: rev, revenueDelta: delta(rev, prevRev, hasPrev),
      hstCollected: num(ro.hst),
      orders: ord, ordersDelta: delta(ord, prevOrd, hasPrev),
      units,
      avgOrder: avg, avgDelta: delta(avg, prevAvg, hasPrev),
      profit, profitDelta: delta(profit, prevProfit, hasPrev),
      marginPct: costedValue > 0 ? (profit / costedValue) * 100 : 0,
      soldValue, costedValue, costCoverage, unitsWithCost: num(up.units_with_cost)
    },
    pipeline: { invoices: invoicesOpen, quotes: quotesOpen },
    salvage, deals, funnel, reps,
    series, byCategory, topModels, topCustomers, recentOrders
  };
}

// ── Fulfilment & supply-chain dashboard ──────────────────────────────────────
export async function fulfilmentDashboard(period = 'month') {
  if (!hasDb()) return null;
  if (!DASH_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = dashWindow(period);
  const [cs, ce] = w.cur;
  const inDel = `${LT('o.delivered_at')} >= ${cs} AND ${LT('o.delivered_at')} < ${ce}`;

  // Current open pipeline by active stage (snapshot, not period-bound).
  const st = (await query(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`)).rows
    .reduce((m, r) => { m[r.status] = num(r.c); return m; }, {});
  const activeStages = [
    { stage: 'Confirmed', count: st.confirmed || 0 },
    { stage: 'Ready', count: st.ready || 0 },
    { stage: 'Out for delivery', count: st.out_for_delivery || 0 }
  ];

  // Completions in the period (by delivered_at).
  const f = (await query(`
    SELECT COUNT(*) AS delivered,
      COUNT(*) FILTER (WHERE o.delivery_method='delivery') AS deliveries,
      COUNT(*) FILTER (WHERE o.delivery_method='pickup') AS pickups,
      COUNT(*) FILTER (WHERE o.delivered_at IS NOT NULL AND o.delivery_date IS NOT NULL AND (${LT('o.delivered_at')})::date <= o.delivery_date) AS on_time,
      COUNT(*) FILTER (WHERE o.delivered_at IS NOT NULL AND o.delivery_date IS NOT NULL AND (${LT('o.delivered_at')})::date >  o.delivery_date) AS late,
      AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.created_at))/86400.0) AS avg_days,
      COUNT(*) FILTER (WHERE o.pod_signature IS NOT NULL OR EXISTS (SELECT 1 FROM pod_photos p WHERE p.order_id = o.id)) AS with_pod
    FROM orders o WHERE o.status='delivered' AND ${inDel}`)).rows[0] || {};

  const series = (await query(`
    SELECT to_char(g, '${w.fmt}') AS label, COUNT(o.id) AS value
      FROM generate_series(${cs}, ${ce} - interval '1 ${w.unit}', interval '1 ${w.unit}') g
      LEFT JOIN orders o ON o.status='delivered' AND date_trunc('${w.unit}', ${LT('o.delivered_at')}) = g
     GROUP BY g ORDER BY g`)).rows.map((r) => ({ label: r.label, value: num(r.value) }));

  const drivers = (await query(`
    SELECT COALESCE(u.name, u.email, 'Unassigned') AS driver, COUNT(*) AS stops
      FROM orders o LEFT JOIN users u ON u.id = o.driver_id
     WHERE o.status='delivered' AND ${inDel}
     GROUP BY 1 ORDER BY stops DESC LIMIT 10`)).rows.map((r) => ({ driver: r.driver, stops: num(r.stops) }));

  const upcoming = (await query(`
    SELECT o.order_number, o.name, o.city, o.delivery_date, COALESCE(u.name, u.email) AS driver, o.status
      FROM orders o LEFT JOIN users u ON u.id = o.driver_id
     WHERE o.status IN ('confirmed','ready','out_for_delivery') AND o.delivery_method='delivery'
     ORDER BY o.delivery_date NULLS LAST, o.created_at LIMIT 10`)).rows.map((r) => ({
    orderNumber: r.order_number, name: r.name, city: r.city,
    deliveryDate: r.delivery_date ? new Date(r.delivery_date).toISOString().slice(0, 10) : null,
    driver: r.driver, status: r.status
  }));

  const delivered = num(f.delivered), onTime = num(f.on_time), late = num(f.late);
  const scheduled = onTime + late;
  return {
    period, unit: w.unit,
    kpis: {
      delivered, deliveries: num(f.deliveries), pickups: num(f.pickups),
      onTime, late, onTimePct: scheduled ? (onTime / scheduled) * 100 : 0,
      avgDays: num(f.avg_days), withPod: num(f.with_pod),
      podPct: delivered ? (num(f.with_pod) / delivered) * 100 : 0
    },
    activeStages, series, drivers, upcoming
  };
}

// ── Customer insights dashboard ──────────────────────────────────────────────
export async function customersDashboard(period = 'month') {
  if (!hasDb()) return null;
  if (!DASH_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = dashWindow(period);
  const [cs, ce] = w.cur;
  const inCur = (lt) => `${lt} >= ${cs} AND ${lt} < ${ce}`;

  const signups = num((await query(`SELECT COUNT(*) AS c FROM users WHERE ${inCur(LT('created_at'))}`)).rows[0]?.c);

  const bx = (await query(`
    WITH pb AS (SELECT DISTINCT lower(email) AS em FROM orders WHERE status IN ${SALE} AND ${inCur(LT('created_at'))})
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM orders o2 WHERE lower(o2.email)=pb.em AND o2.status IN ${SALE} AND ${LT('o2.created_at')} < ${cs}
      )) AS returning
    FROM pb`)).rows[0] || {};
  const buyers = num(bx.total), returning = num(bx.returning), newBuyers = buyers - returning;

  const rep = (await query(`
    SELECT COUNT(*) AS buyers, COUNT(*) FILTER (WHERE cnt > 1) AS repeat
      FROM (SELECT lower(email) AS em, COUNT(*) AS cnt FROM orders WHERE status IN ${SALE} GROUP BY 1) t`)).rows[0] || {};
  const repeatRate = num(rep.buyers) ? (num(rep.repeat) / num(rep.buyers)) * 100 : 0;

  const clv = num((await query(`
    SELECT COALESCE(AVG(spent),0) AS clv FROM (
      SELECT lower(email) AS em, SUM(total) AS spent FROM orders WHERE status IN ${SALE} GROUP BY 1) t`)).rows[0]?.clv);

  const segments = (await query(`
    SELECT CASE WHEN u.role='member' THEN 'Members' ELSE 'Retail' END AS segment,
           COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(o.total),0) AS revenue
      FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status IN ${SALE} AND ${inCur(LT('o.created_at'))}
     GROUP BY 1 ORDER BY revenue DESC`)).rows.map((r) => ({ segment: r.segment, orders: num(r.orders), revenue: num(r.revenue) }));

  const geography = (await query(`
    SELECT COALESCE(NULLIF(city,''),'—') AS city, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
      FROM orders WHERE status IN ${SALE} AND ${inCur(LT('created_at'))}
     GROUP BY 1 ORDER BY revenue DESC LIMIT 12`)).rows.map((r) => ({ city: r.city, orders: num(r.orders), revenue: num(r.revenue) }));

  return {
    period,
    kpis: { signups, buyers, newBuyers, returning, repeatRate, clv },
    segments, geography
  };
}

// ── Financial health dashboard ───────────────────────────────────────────────
// Sold units whose cost isn't on file (products.cost IS NULL) — these are what
// inflate profit/margin. SKU'd lines only (service/fee lines legitimately have no
// cost). No customer PII — just order #, unit, and price, so it's safe to surface.
export async function soldUnitsMissingCost() {
  if (!hasDb()) return { count: 0, uncostedValue: 0, byOrder: [] };
  const { rows } = await query(`
    SELECT o.order_number, o.created_at, oi.sku, oi.title, oi.price,
           p.make, p.model, (p.sku IS NULL) AS not_in_catalog
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE o.status IN ${SALE} AND oi.sku IS NOT NULL AND p.cost IS NULL
     ORDER BY o.created_at DESC, oi.id`);
  const byOrderMap = new Map();
  let uncostedValue = 0;
  for (const r of rows) {
    uncostedValue += num(r.price);
    const key = r.order_number || '(no order #)';
    if (!byOrderMap.has(key)) byOrderMap.set(key, { order: key, date: r.created_at ? r.created_at.toISOString().slice(0, 10) : null, units: [] });
    byOrderMap.get(key).units.push({
      sku: r.sku, title: r.title, price: num(r.price),
      makeModel: [r.make, r.model].filter(Boolean).join(' '),
      notInCatalog: r.not_in_catalog
    });
  }
  return { count: rows.length, uncostedValue: Math.round(uncostedValue * 100) / 100, byOrder: [...byOrderMap.values()] };
}

export async function financialDashboard(period = 'month') {
  if (!hasDb()) return null;
  if (!DASH_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = dashWindow(period);
  const [cs, ce] = w.cur;
  const inCur = (lt) => `${lt} >= ${cs} AND ${lt} < ${ce}`;

  // Pre-tax revenue (exclude HST) so gross profit / margin aren't inflated by the
  // tax we collect for the CRA. COGS is already tax-free, so both sides match.
  const rev = num((await query(`SELECT COALESCE(SUM(total - COALESCE(hst,0)),0) AS r FROM orders WHERE status IN ${SALE} AND ${inCur(LT('created_at'))}`)).rows[0]?.r);
  const cg = (await query(`
    SELECT COALESCE(SUM(oi.price),0) AS sold_value, COALESCE(SUM(p.cost),0) AS cost
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE o.status IN ${SALE} AND ${inCur(LT('o.created_at'))}`)).rows[0] || {};
  const cogs = num(cg.cost), grossProfit = rev - cogs;

  // Gross-profit trend (item revenue − item cost) per bucket.
  const series = (await query(`
    SELECT to_char(g, '${w.fmt}') AS label,
           COALESCE(SUM(oi.price - COALESCE(p.cost,0)),0) AS value
      FROM generate_series(${cs}, ${ce} - interval '1 ${w.unit}', interval '1 ${w.unit}') g
      LEFT JOIN orders o ON o.status IN ${SALE} AND date_trunc('${w.unit}', ${LT('o.created_at')}) = g
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.sku = oi.sku
     GROUP BY g ORDER BY g`)).rows.map((r) => ({ label: r.label, value: num(r.value) }));

  // AR aging — open invoices by overdue bucket.
  let aging = { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
  try {
    const a = (await query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE due_date IS NULL OR due_date >= now()::date),0) AS current,
        COALESCE(SUM(total) FILTER (WHERE due_date < now()::date AND due_date >= now()::date - 30),0) AS d30,
        COALESCE(SUM(total) FILTER (WHERE due_date < now()::date - 30 AND due_date >= now()::date - 60),0) AS d60,
        COALESCE(SUM(total) FILTER (WHERE due_date < now()::date - 60),0) AS d90,
        COALESCE(SUM(total),0) AS total
      FROM invoices WHERE status='open'`)).rows[0] || {};
    aging = { current: num(a.current), d30: num(a.d30), d60: num(a.d60), d90: num(a.d90), total: num(a.total) };
  } catch { /* no invoices table */ }

  // Collections by method in the period (paid invoices + confirmed orders).
  let collections = [];
  try {
    collections = (await query(`
      SELECT method, SUM(amount) AS amount FROM (
        SELECT COALESCE(NULLIF(payment_method,''),'unspecified') AS method, total AS amount
          FROM invoices WHERE status='paid' AND ${inCur(LT('paid_at'))}
        UNION ALL
        SELECT COALESCE(NULLIF(payment_method,''),'unspecified') AS method, total AS amount
          FROM orders WHERE status IN ${SALE} AND order_number IS NOT NULL AND ${inCur(LT('created_at'))}
            AND id NOT IN (SELECT order_id FROM invoices WHERE order_id IS NOT NULL)
      ) t GROUP BY method ORDER BY amount DESC`)).rows.map((r) => ({ method: r.method, amount: num(r.amount) }));
  } catch { /* ignore */ }

  // Operating expenses + ad spend in the period.
  let expenses = { total: 0, byCategory: [] };
  let adSpend = 0;
  try {
    const ex = (await query(`SELECT COALESCE(category,'Other') AS category, COALESCE(SUM(amount),0) AS amount FROM expenses WHERE ${inCur('incurred_on')} GROUP BY 1 ORDER BY amount DESC`)).rows.map((r) => ({ category: r.category, amount: num(r.amount) }));
    expenses = { total: ex.reduce((s, e) => s + e.amount, 0), byCategory: ex };
  } catch { /* no expenses table */ }
  try {
    adSpend = num((await query(`SELECT COALESCE(SUM(amount),0) AS a FROM ad_spend WHERE ${inCur('spent_on')}`)).rows[0]?.a);
  } catch { /* no ad_spend table */ }

  const opex = expenses.total + adSpend;
  const netProfit = grossProfit - opex;
  const inv = await inventoryFinancials();
  const collected = collections.reduce((s, c) => s + c.amount, 0);

  return {
    period, unit: w.unit,
    kpis: {
      revenue: rev, cogs, grossProfit, marginPct: rev > 0 ? (grossProfit / rev) * 100 : 0,
      opex, adSpend, expenses: expenses.total, netProfit,
      collected, inventoryCost: inv.inventoryCost
    },
    series, aging, collections, expensesByCategory: expenses.byCategory, inventory: inv
  };
}

// ── Marketing & leads dashboard ──────────────────────────────────────────────
export async function marketingDashboard(period = 'month') {
  if (!hasDb()) return null;
  if (!DASH_PERIODS.some((p) => p.key === period)) period = 'month';
  const w = dashWindow(period);
  const [cs, ce] = w.cur;
  const inCur = (lt) => `${lt} >= ${cs} AND ${lt} < ${ce}`;

  const signups = num((await query(`SELECT COUNT(*) AS c FROM users WHERE ${inCur(LT('created_at'))}`)).rows[0]?.c);

  let quoteRequests = 0, quotes = 0, converted = 0;
  try {
    const q = (await query(`
      SELECT COUNT(*) FILTER (WHERE source='customer') AS requests,
             COUNT(*) AS quotes,
             COUNT(*) FILTER (WHERE status='converted') AS converted
        FROM quotes WHERE ${inCur(LT('created_at'))}`)).rows[0] || {};
    quoteRequests = num(q.requests); quotes = num(q.quotes); converted = num(q.converted);
  } catch { /* no quotes table */ }

  let invoicesPaid = 0, revenue = 0;
  try {
    invoicesPaid = num((await query(`SELECT COUNT(*) AS c FROM invoices WHERE status='paid' AND ${inCur(LT('paid_at'))}`)).rows[0]?.c);
  } catch { /* ignore */ }
  revenue = num((await query(`SELECT COALESCE(SUM(total - COALESCE(hst,0)),0) AS r FROM orders WHERE status IN ${SALE} AND ${inCur(LT('created_at'))}`)).rows[0]?.r);

  let adSpend = 0, byChannel = [];
  try {
    adSpend = num((await query(`SELECT COALESCE(SUM(amount),0) AS a FROM ad_spend WHERE ${inCur('spent_on')}`)).rows[0]?.a);
    byChannel = (await query(`SELECT channel, COALESCE(SUM(amount),0) AS amount FROM ad_spend WHERE ${inCur('spent_on')} GROUP BY 1 ORDER BY amount DESC`)).rows.map((r) => ({ channel: r.channel, amount: num(r.amount) }));
  } catch { /* no ad_spend table */ }

  // Leads trend — quote requests + signups per bucket.
  let leadSeries = [];
  try {
    leadSeries = (await query(`
      SELECT to_char(g, '${w.fmt}') AS label,
        (SELECT COUNT(*) FROM quotes q WHERE q.source='customer' AND date_trunc('${w.unit}', ${LT('q.created_at')}) = g) AS value
      FROM generate_series(${cs}, ${ce} - interval '1 ${w.unit}', interval '1 ${w.unit}') g
      ORDER BY g`)).rows.map((r) => ({ label: r.label, value: num(r.value) }));
  } catch {
    leadSeries = [];
  }

  let campaigns = [];
  try {
    campaigns = (await query(`SELECT channel, segment, subject, recipients, sent, created_at FROM campaign_log WHERE ${inCur('created_at')} ORDER BY created_at DESC LIMIT 10`)).rows.map((r) => ({ channel: r.channel, segment: r.segment, subject: r.subject, recipients: num(r.recipients), sent: num(r.sent), createdAt: r.created_at ? r.created_at.toISOString() : null }));
  } catch { /* no campaign_log table */ }

  // Revenue by channel (first-touch attribution on orders) → per-channel ROAS.
  let revByChannel = [];
  try {
    revByChannel = (await query(`
      SELECT COALESCE(NULLIF(source,''),'Direct') AS channel, COALESCE(SUM(total - COALESCE(hst,0)),0) AS revenue, COUNT(*) AS orders
        FROM orders WHERE status IN ${SALE} AND ${inCur(LT('created_at'))}
       GROUP BY 1 ORDER BY revenue DESC`)).rows.map((r) => ({ channel: r.channel, revenue: num(r.revenue), orders: num(r.orders) }));
  } catch { /* source column not added yet */ }

  // Merge spend + revenue per channel for a ROAS table.
  const chMap = new Map();
  for (const c of byChannel) chMap.set(c.channel, { channel: c.channel, spend: c.amount, revenue: 0, orders: 0 });
  for (const r of revByChannel) {
    const e = chMap.get(r.channel) || { channel: r.channel, spend: 0, revenue: 0, orders: 0 };
    e.revenue = r.revenue; e.orders = r.orders; chMap.set(r.channel, e);
  }
  const channels = [...chMap.values()]
    .map((c) => ({ ...c, roas: c.spend > 0 ? c.revenue / c.spend : null }))
    .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);

  const leads = quoteRequests + signups;
  return {
    period, unit: w.unit,
    kpis: {
      leads, quoteRequests, signups, quotes, converted, invoicesPaid, adSpend, revenue,
      cpl: leads ? adSpend / leads : 0,
      cpa: invoicesPaid ? adSpend / invoicesPaid : 0,
      roas: adSpend > 0 ? revenue / adSpend : 0
    },
    byChannel, revByChannel, channels, leadSeries, campaigns
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
