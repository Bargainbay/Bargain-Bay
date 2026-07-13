// Admin-wide record search: one query across orders, invoices, quotes, and the
// client database, matched on the record number (BB-/INV-/Q-) and the
// customer's name / email / phone. Read-only; every section is best-effort so
// a missing table (fresh DB) never blanks the whole result page.
import { hasDb, query } from './db';
import { listCustomers } from './customers';

const LIMIT = 25;

export async function searchAll(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!hasDb() || needle.length < 2) return { customers: [], orders: [], invoices: [], quotes: [] };
  const like = `%${needle}%`;

  const [customers, orders, invoices, quotes] = await Promise.all([
    listCustomers({ q: needle, limit: LIMIT }).catch(() => []),
    query(
      `SELECT id, order_number, name, email, phone, status, total, created_at
         FROM orders
        WHERE lower(order_number) LIKE $1 OR lower(coalesce(name,'')) LIKE $1
           OR lower(email) LIKE $1 OR coalesce(phone,'') LIKE $1
        ORDER BY created_at DESC LIMIT ${LIMIT}`,
      [like]
    ).then((r) => r.rows).catch(() => []),
    query(
      `SELECT id, number, name, email, status, total, created_at
         FROM invoices
        WHERE lower(coalesce(number,'')) LIKE $1 OR lower(coalesce(name,'')) LIKE $1
           OR lower(email) LIKE $1 OR coalesce(phone,'') LIKE $1
        ORDER BY created_at DESC LIMIT ${LIMIT}`,
      [like]
    ).then((r) => r.rows).catch(() => []),
    query(
      `SELECT id, number, name, email, status, total, created_at
         FROM quotes
        WHERE lower(coalesce(number,'')) LIKE $1 OR lower(coalesce(name,'')) LIKE $1
           OR lower(email) LIKE $1
        ORDER BY created_at DESC LIMIT ${LIMIT}`,
      [like]
    ).then((r) => r.rows).catch(() => [])
  ]);

  const shape = (r, numberKey) => ({
    id: r.id, number: r[numberKey], name: r.name, email: r.email,
    status: r.status, total: Number(r.total || 0),
    createdAt: r.created_at ? r.created_at.toISOString() : null
  });
  return {
    customers,
    orders: orders.map((r) => shape(r, 'order_number')),
    invoices: invoices.map((r) => shape(r, 'number')),
    quotes: quotes.map((r) => shape(r, 'number'))
  };
}
