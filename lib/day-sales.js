// The end-of-day sales picture: what was INVOICED today, and what was PAID today.
//
// Two different questions, and a sale can be in both (raised and settled the
// same afternoon) or only one (a deposit sale raised today, balance on delivery
// next week):
//
//   CREATED  every invoice dated today that is not void
//   PAID     every invoice that became fully paid today
//
// Figures are PRE-TAX (invoice_items.amount is always pre-tax; the HST is the
// CRA's money) with the HST-inclusive total shown beside them, because that is
// the number printed on the invoice. Cost is the cost of the UNIT lines only: a
// delivery or install line has no cost of goods. Net revenue = pre-tax sales
// minus that cost, i.e. what the sale made before overhead.
//
// A unit line with no cost on file is counted as ZERO cost and reported, so net
// revenue is never flattered silently.
//
// Dated in Toronto time. Cash received today (deposits included) is reported
// separately because it is not the same number as "invoices paid".
import { query, hasDb } from './db';
import { round2, torontoToday } from './constants';

const TZ = "AT TIME ZONE 'America/Toronto'";
const n = (v) => Number(v || 0);

const ROWS = (where) => `
  SELECT i.id, i.number, COALESCE(NULLIF(i.name,''), i.email) AS customer, i.status,
         COALESCE(i.channel,'manual') AS channel, i.subtotal, i.hst, i.total,
         COALESCE(SUM(COALESCE(ii.cost, p.cost)) FILTER (WHERE COALESCE(ii.kind,'unit') = 'unit'), 0) AS cost,
         COUNT(*) FILTER (WHERE COALESCE(ii.kind,'unit') = 'unit' AND COALESCE(ii.cost, p.cost) IS NULL)::int AS missing
    FROM invoices i
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    LEFT JOIN products p ON p.sku = ii.sku
   WHERE ${where}
   GROUP BY i.id
   ORDER BY i.id`;

const shape = (r) => {
  const sales = round2(n(r.subtotal)), cost = round2(n(r.cost));
  return {
    id: r.id, number: r.number, customer: r.customer, status: r.status, channel: r.channel,
    sales, hst: round2(n(r.hst)), total: round2(n(r.total)), cost, net: round2(sales - cost), missing: r.missing
  };
};

const totalsOf = (rows) => {
  const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
  return { count: rows.length, sales: sum('sales'), withTax: sum('total'), cost: sum('cost'), net: sum('net'),
    missingCost: rows.reduce((a, r) => a + r.missing, 0) };
};

export async function daySales(date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : torontoToday();
  const empty = { day, created: { rows: [], ...totalsOf([]) }, paid: { rows: [], ...totalsOf([]) }, cashReceived: 0, cashPayments: 0 };
  if (!hasDb()) return empty;
  const [created, paid, cash] = await Promise.all([
    query(ROWS(`(i.created_at ${TZ})::date = $1::date AND i.status <> 'void'`), [day]),
    query(ROWS(`i.status = 'paid' AND (i.paid_at ${TZ})::date = $1::date`), [day]),
    query(`SELECT COALESCE(SUM(p.amount),0) AS amt, COUNT(*)::int AS c
             FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
            WHERE i.status <> 'void' AND (p.paid_at ${TZ})::date = $1::date`, [day])
  ]);
  const c = created.rows.map(shape), p = paid.rows.map(shape);
  return {
    day,
    created: { rows: c, ...totalsOf(c) },
    paid: { rows: p, ...totalsOf(p) },
    cashReceived: round2(n(cash.rows[0]?.amt)), cashPayments: cash.rows[0]?.c || 0
  };
}
