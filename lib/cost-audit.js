// READ-ONLY: which sold units are costed at $0 on an invoice or order line when
// the product itself has a real cost.
//
// Cause: an empty cost box was saved as 0 (see costOrNull in lib/constants.js).
// A stored 0 beats the tracker's cost in every profit query
// (COALESCE(line.cost, products.cost)), so those sales read as pure profit.
//
// This only REPORTS. It changes nothing. A line whose product cost is also 0 or
// unknown is not listed: that may be a genuine haul-away, and zero is a real
// answer there.
import { query, hasDb } from './db';
import { round2 } from './constants';

const n = (v) => Number(v || 0);

export async function zeroCostLines() {
  if (!hasDb()) return { invoiceLines: [], orderLines: { count: 0, orders: 0 }, summary: {} };
  const inv = await query(
    `SELECT i.number, i.status, to_char(i.created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS day,
            COALESCE(NULLIF(i.name,''), i.email) AS customer,
            ii.id AS line_id, ii.sku, ii.description, ii.amount, p.cost AS product_cost
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products p ON p.sku = ii.sku
      WHERE COALESCE(ii.kind,'unit') = 'unit' AND ii.cost = 0
        AND ii.sku IS NOT NULL AND p.cost > 0 AND i.status <> 'void'
      ORDER BY i.created_at DESC, ii.id`);
  const ord = await query(
    `SELECT COUNT(*)::int AS lines, COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM(p.cost),0) AS cost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.sku = oi.sku
      WHERE COALESCE(oi.kind,'unit') = 'unit' AND oi.cost = 0 AND oi.sku IS NOT NULL
        AND p.cost > 0 AND o.status <> 'cancelled'`);
  const lines = inv.rows.map((r) => ({
    invoice: r.number, status: r.status, day: r.day, customer: r.customer, sku: r.sku,
    description: r.description, sold: round2(n(r.amount)), trackerCost: round2(n(r.product_cost))
  }));
  return {
    invoiceLines: lines,
    orderLines: { count: ord.rows[0]?.lines || 0, orders: ord.rows[0]?.orders || 0, cost: round2(n(ord.rows[0]?.cost)) },
    summary: {
      lines: lines.length,
      invoices: new Set(lines.map((l) => l.invoice)).size,
      costLeftOut: round2(lines.reduce((a, l) => a + l.trackerCost, 0)),
      sales: round2(lines.reduce((a, l) => a + l.sold, 0))
    }
  };
}
