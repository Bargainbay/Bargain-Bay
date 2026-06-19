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
