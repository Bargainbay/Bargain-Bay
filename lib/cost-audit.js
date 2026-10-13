// Sold units costed at $0 on an invoice or order line when the product has a
// real cost, and the one-time correction for them.
//
// Cause: an empty cost box was saved as 0 (see costOrNull in lib/constants.js).
// A stored 0 beats the tracker's cost in every profit query
// (COALESCE(line.cost, products.cost)), so those sales read as pure profit.
//
// THE CORRECTION sets those lines' cost back to NULL, i.e. "use the product's
// cost", which is what an empty box always meant. It does not invent a figure.
//
// Rules that keep it safe:
//   - Only lines whose product has a REAL cost (> 0). A line whose product cost
//     is also 0 or unknown may be a genuine haul-away, and zero is a real answer
//     there, so it is never listed and never touched.
//   - PREVIEW is read-only. APPLY takes the exact ids the preview showed, and
//     RE-CHECKS each one against the same rule inside a transaction, so it can
//     never touch a line the rule does not select (including one somebody
//     corrected by hand between preview and apply).
//   - Both tables change in ONE transaction, or neither does.
//   - Void invoices and cancelled orders are left alone.
import { query, hasDb, withTransaction } from './db';
import { round2 } from './constants';
import { trackerCosts } from './tracker-cost';

const n = (v) => Number(v || 0);

const INVOICE_RULE = `COALESCE(ii.kind,'unit') = 'unit' AND ii.cost = 0
        AND ii.sku IS NOT NULL AND p.cost > 0 AND i.status <> 'void'`;
const ORDER_RULE = `COALESCE(oi.kind,'unit') = 'unit' AND oi.cost = 0
        AND oi.sku IS NOT NULL AND p.cost > 0 AND o.status <> 'cancelled'`;

export async function zeroCostLines() {
  if (!hasDb()) return { invoiceLines: [], orderLines: { count: 0, orders: 0, cost: 0, ids: [] }, summary: {} };
  const inv = await query(
    `SELECT i.number, i.status, to_char(i.created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS day,
            COALESCE(NULLIF(i.name,''), i.email) AS customer,
            ii.id AS line_id, ii.sku, ii.description, ii.amount, p.cost AS product_cost
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products p ON p.sku = ii.sku
      WHERE ${INVOICE_RULE}
      ORDER BY i.created_at DESC, ii.id`);
  const ord = await query(
    `SELECT oi.id, o.id AS order_id, p.cost AS product_cost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.sku = oi.sku
      WHERE ${ORDER_RULE}`);
  const lines = inv.rows.map((r) => ({
    id: r.line_id, invoice: r.number, status: r.status, day: r.day, customer: r.customer, sku: r.sku,
    description: r.description, sold: round2(n(r.amount)), trackerCost: round2(n(r.product_cost))
  }));
  return {
    invoiceLines: lines,
    orderLines: {
      count: ord.rows.length, orders: new Set(ord.rows.map((r) => r.order_id)).size,
      cost: round2(ord.rows.reduce((a, r) => a + n(r.product_cost), 0)), ids: ord.rows.map((r) => r.id)
    },
    summary: {
      lines: lines.length,
      invoices: new Set(lines.map((l) => l.invoice)).size,
      costLeftOut: round2(lines.reduce((a, l) => a + l.trackerCost, 0)),
      sales: round2(lines.reduce((a, l) => a + l.sold, 0))
    }
  };
}

const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];

/**
 * Apply the correction to exactly the lines the preview showed.
 * Returns what changed, and what was skipped because it no longer matches.
 */
export async function applyZeroCostFix({ invoiceLineIds, orderLineIds }) {
  const invIds = ids(invoiceLineIds), ordIds = ids(orderLineIds);
  if (!invIds.length && !ordIds.length) throw new Error('Nothing to correct. Run the preview first.');
  return withTransaction(async (client) => {
    // The id list is re-checked against the SAME rule; a row that no longer
    // matches (fixed by hand, voided, cost changed) is skipped, not forced.
    const a = invIds.length ? await client.query(
      `UPDATE invoice_items ii SET cost = NULL
         FROM invoices i, products p
        WHERE ii.id = ANY($1::int[]) AND i.id = ii.invoice_id AND p.sku = ii.sku AND ${INVOICE_RULE}
        RETURNING ii.id`, [invIds]) : { rows: [] };
    const b = ordIds.length ? await client.query(
      `UPDATE order_items oi SET cost = NULL
         FROM orders o, products p
        WHERE oi.id = ANY($1::int[]) AND o.id = oi.order_id AND p.sku = oi.sku AND ${ORDER_RULE}
        RETURNING oi.id`, [ordIds]) : { rows: [] };
    return {
      invoiceLines: a.rows.length, orderLines: b.rows.length,
      skipped: (invIds.length - a.rows.length) + (ordIds.length - b.rows.length),
      invoiceLineIds: a.rows.map((r) => r.id), orderLineIds: b.rows.map((r) => r.id)
    };
  });
}

// ── Lines with NO cost at all, where the tracker has one ─────────────────────
// A unit sold before the site imported it: the invoice line's cost is blank AND
// the site has no product cost to fall back on. The tracker has the figure.
// The correction COPIES the tracker's cost onto the line (and its order line).
// Only lines the tracker states a cost for; an empty tracker cell fills nothing,
// and the tracker is re-read at apply time, so the figure applied is the one the
// tracker holds then, never one sent from the browser.
const BLANK_RULE = `COALESCE(ii.kind,'unit') = 'unit' AND ii.cost IS NULL AND ii.sku IS NOT NULL
        AND i.status <> 'void' AND (p.sku IS NULL OR p.cost IS NULL OR p.cost = 0)`;

export async function missingCostLines({ read = trackerCosts } = {}) {
  if (!hasDb()) return { lines: [], summary: { lines: 0, invoices: 0, costToAdd: 0, noTrackerCost: 0 } };
  const { rows } = await query(
    `SELECT i.number, i.status, to_char(i.created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS day,
            COALESCE(NULLIF(i.name,''), i.email) AS customer, ii.id, ii.sku, ii.description, ii.amount
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.sku = ii.sku
      WHERE ${BLANK_RULE}
      ORDER BY i.created_at DESC, ii.id`);
  const costs = await read();
  const lines = [];
  let noTrackerCost = 0;
  for (const r of rows) {
    const c = costs.get(String(r.sku).trim().toUpperCase());
    if (c == null) { noTrackerCost += 1; continue; }
    lines.push({ id: r.id, invoice: r.number, status: r.status, day: r.day, customer: r.customer, sku: r.sku,
      description: r.description, sold: round2(n(r.amount)), trackerCost: c });
  }
  return {
    lines,
    summary: {
      lines: lines.length, invoices: new Set(lines.map((l) => l.invoice)).size,
      costToAdd: round2(lines.reduce((a, l) => a + l.trackerCost, 0)),
      noTrackerCost   // blank on the site AND not stated on the tracker: needs a person
    }
  };
}

export async function applyMissingCostFill({ lineIds, read = trackerCosts }) {
  const want = ids(lineIds);
  if (!want.length) throw new Error('Nothing to fill. Run the preview first.');
  const costs = await read({ maxAgeMs: 0 });   // fresh: never apply a cached figure
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ii.id, ii.sku, i.order_id
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         LEFT JOIN products p ON p.sku = ii.sku
        WHERE ii.id = ANY($1::int[]) AND ${BLANK_RULE}`, [want]);
    const filled = [], orderFilled = [];
    for (const r of rows) {
      const c = costs.get(String(r.sku).trim().toUpperCase());
      if (c == null) continue;
      await client.query('UPDATE invoice_items SET cost = $2 WHERE id = $1 AND cost IS NULL', [r.id, c]);
      filled.push(r.id);
      if (r.order_id) {
        const o = await client.query(
          `UPDATE order_items SET cost = $3 WHERE order_id = $1 AND sku = $2 AND cost IS NULL
             AND COALESCE(kind,'unit') = 'unit' RETURNING id`, [r.order_id, r.sku, c]);
        orderFilled.push(...o.rows.map((x) => x.id));
      }
    }
    return { invoiceLines: filled.length, orderLines: orderFilled.length, skipped: want.length - filled.length,
      invoiceLineIds: filled, orderLineIds: orderFilled };
  });
}

// How many sold unit lines have NO cost anywhere (blank on the line, none on the
// site). DB only: no tracker read, so it is cheap enough for every page load.
// It counts lines the tracker MAY be able to fill; the fix page says which can.
export async function blankCostCount() {
  if (!hasDb()) return 0;
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.sku = ii.sku
      WHERE ${BLANK_RULE}`);
  return rows[0]?.c || 0;
}
