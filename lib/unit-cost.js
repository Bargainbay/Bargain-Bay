// A unit's cost typed by hand on Stock gaps, and carried everywhere a cost lives.
//
// For units still waiting on their purchase invoice. The figure goes to the
// tracker's COST OF PRODUCT cell (the source of truth); the sheet's own formula
// makes Total Cost = product + parts + labour, and that total is what is copied
// onto everything on this side that holds a unit's cost:
//   - products.cost            (profit reports, inventory value, pricing floors)
//   - salvage_units.cost       (salvage margin; re-spread over harvested parts
//                               if the unit was already parted out)
//   - invoice_items / order_items cost on sales of this unit
// Everything else (P&L, ledger, commissions, dashboards) is worked out from those
// on read, so there is nothing else to update.
//
// RULES
//   - The row stays NEEDS INVOICE. A typed cost is not a purchase invoice: the
//     HST credit is still unclaimed, and uploading the invoice later still
//     matches the row (its figure then replaces this one, through the same path).
//   - A sale line is changed only where its cost is blank, zero, or the figure
//     this unit carried until now. A DIFFERENT cost somebody typed on a line is
//     left alone and named.
//   - The tracker write is the LAST step inside the database transaction: a
//     refused write (staging, no credentials, a Google error) saves nothing.
//   - PRE-TAX, like every cost of ours. 0 is a real answer; blank is not.
import { withTransaction, hasDb } from './db';
import { round2 } from './constants';
import { readTrackerRows, writeTrackerCells } from './sheets';
import { parseCostCell, costFromRow } from './tracker-cost';
import { isWaitingForInvoice } from './stock-match';
import { respreadPartOut } from './parts';

const up = (s) => String(s ?? '').trim().toUpperCase();
const MAX_COST = 100000;

const defaultDeps = { read: readTrackerRows, write: writeTrackerCells };

/** "$1,250.00" → 1250. Null when it is not a usable cost. */
export function typedCost(v) {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_COST ? round2(n) : null;
}

/** The Total Cost the sheet will show once Cost of Product reads `cost`. */
export function totalAfter(row, cost) {
  const total = parseCostCell(row?.totalCost);
  const extras = total != null
    ? Math.max(0, total - (parseCostCell(row?.cost) || 0))   // parts + labour already in the total
    : (parseCostCell(row?.partsCost) || 0);
  return round2(Number(cost) + extras);
}

/**
 * Copy one unit's new Total Cost onto every stored copy of it. `oldTotal` is what
 * the unit carried until now (null if nothing). Runs on the caller's client.
 */
export async function propagateUnitCost(client, { sku, oldTotal = null, total }) {
  const key = up(sku);
  await client.query('UPDATE products SET cost = $2 WHERE upper(sku) = $1', [key, total]);
  await client.query('UPDATE salvage_units SET cost = $2 WHERE upper(sku) = $1', [key, total]);
  await respreadPartOut(client, sku, total);

  // $3 is NULL when the unit had no cost, and `cost = NULL` matches nothing.
  const old = oldTotal == null ? null : round2(oldTotal);
  const inv = await client.query(
    `UPDATE invoice_items SET cost = $2
      WHERE upper(sku) = $1 AND COALESCE(kind,'unit') = 'unit'
        AND (cost IS NULL OR cost = 0 OR cost = $3::numeric)
      RETURNING id`, [key, total, old]);
  const ord = await client.query(
    `UPDATE order_items SET cost = $2
      WHERE upper(sku) = $1 AND COALESCE(kind,'unit') = 'unit'
        AND (cost IS NULL OR cost = 0 OR cost = $3::numeric)
      RETURNING id`, [key, total, old]);
  const kept = await client.query(
    `SELECT i.number, ii.cost FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE upper(ii.sku) = $1 AND COALESCE(ii.kind,'unit') = 'unit' AND i.status <> 'void'
        AND ii.cost IS DISTINCT FROM $2::numeric`, [key, total]);
  return {
    invoiceLines: inv.rows.length,
    orderLines: ord.rows.length,
    kept: kept.rows.map((r) => ({ sku, invoice: r.number, cost: Number(r.cost) }))
  };
}

/**
 * Save costs typed against units waiting for their purchase invoice.
 * entries: [{ sku, cost }]
 */
export async function setWaitingCosts(entries = [], { deps = defaultDeps } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const want = new Map();
  const refused = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const sku = String(e?.sku ?? '').trim();
    if (!sku) continue;
    const cost = typedCost(e.cost);
    if (cost == null) { refused.push({ sku, reason: 'not a cost — type a number like 248.75' }); continue; }
    want.set(up(sku), { sku, cost });
  }
  if (!want.size) {
    if (refused.length) return { saved: [], refused, invoiceLines: 0, orderLines: 0, kept: [] };
    throw new Error('Type a cost first.');
  }
  if (want.size > 300) throw new Error('Save at most 300 costs at a time.');

  const bySku = new Map((await deps.read()).map((r) => [up(r.sku), r]));
  const todo = [];
  for (const [key, w] of want) {
    const row = bySku.get(key);
    if (!row) { refused.push({ sku: w.sku, reason: 'not on the tracker' }); continue; }
    if (!isWaitingForInvoice(row.invoice)) { refused.push({ sku: w.sku, reason: 'no longer waiting for an invoice — reload the page' }); continue; }
    todo.push({ row, cost: w.cost, oldTotal: costFromRow(row), total: totalAfter(row, w.cost) });
  }
  if (!todo.length) return { saved: [], refused, invoiceLines: 0, orderLines: 0, kept: [] };

  return withTransaction(async (client) => {
    const out = { saved: [], refused, invoiceLines: 0, orderLines: 0, kept: [] };
    for (const t of todo) {
      const p = await propagateUnitCost(client, { sku: t.row.sku, oldTotal: t.oldTotal, total: t.total });
      out.invoiceLines += p.invoiceLines;
      out.orderLines += p.orderLines;
      out.kept.push(...p.kept);
      out.saved.push({ sku: t.row.sku, cost: t.cost, was: parseCostCell(t.row.cost), total: t.total });
    }
    // LAST, inside the transaction: a refused tracker write rolls everything back.
    await deps.write(todo.map((t) => ({ row: t.row.row, field: 'cost', value: t.cost })));
    return out;
  });
}
