// Owner CRM / sales-tracker dashboard data — all derived from Postgres
// (orders, order_items, users). Read-only; safe no-op without a database.
import { query, hasDb } from './db';

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

// Full customer database: every registered user with their purchase rollups.
export async function customerList() {
  if (!hasDb()) return [];
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.member_status, u.business_name, u.created_at,
           COUNT(o.id)               FILTER (WHERE o.status IN ${SALE}) AS orders,
           COALESCE(SUM(o.total),0)  FILTER (WHERE o.status IN ${SALE}) AS spent,
           MAX(o.created_at)         FILTER (WHERE o.status IN ${SALE}) AS last_order
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
