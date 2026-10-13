// Money spent on parts for ONE unit, and getting it into the unit's cost.
//
// The record is `unit_part_costs` (migration 0030). The unit's parts lines are
// SUMMED and written to the tracker's Parts Cost cell; the tracker's own formula
// makes Total Cost = product + parts + labour, which is what the site's product
// cost and every profit figure already read. Nothing else is invented here.
//
// RULES
//   - The tracker write is INSIDE the database transaction: if the tracker
//     refuses (no credentials, staging, a Google error) nothing is saved, so the
//     record can never claim a cost the tracker does not carry.
//   - The cell is written as an ABSOLUTE sum, never an increment, so a retry or a
//     double click cannot double it.
//   - A Parts Cost somebody already TYPED on the tracker is never overwritten
//     silently: if the cell disagrees with what we have recorded, the save is
//     refused until that figure is adopted as its own line ("tracker" source).
//   - Rows are voided, never deleted.
//   - After the cell changes, products.cost follows, and so do invoice / order
//     lines that were carrying the OLD total as a snapshot. A cost somebody typed
//     on a line (a different figure) is left alone.
import { withTransaction, query, hasDb } from './db';
import { round2, torontoToday } from './constants';
import { readTrackerRows, writeTrackerCells } from './sheets';
import { parseCostCell, costFromRow } from './tracker-cost';

const up = (s) => String(s ?? '').trim().toUpperCase();
const clean = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const n = (v) => Number(v || 0);

const defaultDeps = { read: readTrackerRows, write: writeTrackerCells };

const shapeUnit = (r) => ({
  sku: r.sku, row: r.row, make: r.make, model: r.model, description: r.description, serial: r.serial,
  status: r.status, vendor: r.vendor, lot: r.lot,
  productCost: parseCostCell(r.cost), partsCost: parseCostCell(r.partsCost), totalCost: costFromRow(r)
});

/** Find units on the tracker (any status, sold included) by SKU, make, model, serial or words. */
export async function findUnits(q, { limit = 12, deps = defaultDeps } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rows = await deps.read();
  const out = [];
  for (const r of rows) {
    const hay = `${r.sku} ${r.make} ${r.model} ${r.description} ${r.serial} ${r.lot} ${r.category}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) { out.push(shapeUnit(r)); if (out.length >= limit) break; }
  }
  return out;
}

const shapeLine = (r) => ({
  id: r.id, sku: r.sku, partName: r.part_name, partNumber: r.part_number, supplier: r.supplier,
  amount: round2(n(r.amount)), orderedOn: r.ordered_on, source: r.source, note: r.note,
  createdBy: r.created_by, createdAt: r.created_at, voided: !!r.voided_at
});

export async function partLinesFor(sku, { includeVoided = true } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, sku, part_name, part_number, supplier, amount, to_char(ordered_on,'YYYY-MM-DD') AS ordered_on,
            source, note, created_by, created_at, voided_at
       FROM unit_part_costs WHERE upper(sku) = $1 ${includeVoided ? '' : 'AND voided_at IS NULL'}
      ORDER BY created_at DESC, id DESC`, [up(sku)]);
  return rows.map(shapeLine);
}

export async function recentPartCosts(limit = 40) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, sku, part_name, part_number, supplier, amount, to_char(ordered_on,'YYYY-MM-DD') AS ordered_on,
            source, note, created_by, created_at, voided_at
       FROM unit_part_costs ORDER BY created_at DESC, id DESC LIMIT $1`, [limit]);
  return rows.map(shapeLine);
}

const sumOf = async (client, sku) => round2(n((await client.query(
  'SELECT COALESCE(SUM(amount),0) AS s FROM unit_part_costs WHERE upper(sku) = $1 AND voided_at IS NULL', [up(sku)])).rows[0]?.s));

export class PartCostError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

// Everything that changes a unit's parts lines goes through here, so the guard,
// the transaction and the tracker write can never drift apart.
async function changeParts(sku, mutate, { adoptExisting = false, deps = defaultDeps } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const rows = await deps.read();
  const row = rows.find((r) => up(r.sku) === up(sku));
  if (!row) throw new PartCostError(`${sku} is not on the tracker, so there is nowhere to record its parts cost.`);
  const before = shapeUnit(row);
  const typed = before.partsCost || 0;

  const result = await withTransaction(async (client) => {
    const recorded = await sumOf(client, sku);
    if (typed > 0 && Math.abs(typed - recorded) > 0.005) {
      if (adoptExisting && typed > recorded) {
        // Keep what somebody typed on the tracker as its own line, so it is not lost.
        await client.query(
          `INSERT INTO unit_part_costs (sku, part_name, amount, source, note, created_by)
           VALUES ($1,'Parts already on the tracker',$2,'tracker','Typed on the tracker before parts were recorded here',$3)`,
          [row.sku, round2(typed - recorded), mutate.by || null]);
      } else {
        throw new PartCostError(
          typed > recorded
            ? `The tracker already shows $${typed.toFixed(2)} of parts for ${row.sku}, typed by hand, and only $${recorded.toFixed(2)} is recorded here. Keep the existing $${typed.toFixed(2)} and add this on top?`
            : `The tracker shows $${typed.toFixed(2)} of parts for ${row.sku}, less than the $${recorded.toFixed(2)} recorded here. Fix the Parts Cost cell on the tracker first.`,
          { needsAdopt: typed > recorded, trackerParts: typed, recorded });
      }
    }
    await mutate(client);
    const sum = await sumOf(client, sku);
    // INSIDE the transaction: a refused tracker write rolls the record back.
    await deps.write([{ row: row.row, field: 'partsCost', value: sum }]);
    return sum;
  });

  const after = await refreshCosts(row.sku, before.totalCost, deps).catch((e) => ({ error: e.message }));
  return { partsTotal: result, ...after };
}

// The tracker's formula has recalculated by now. Pull the new Total Cost back
// onto the site's product row, and onto invoice / order lines that were carrying
// the OLD total as a snapshot.
async function refreshCosts(sku, oldTotal, deps) {
  const rows = await deps.read();
  const row = rows.find((r) => up(r.sku) === up(sku));
  const total = row ? costFromRow(row) : null;
  if (total == null) return { totalCost: null };
  await query('UPDATE products SET cost = $2 WHERE upper(sku) = $1', [up(sku), total]).catch(() => {});
  let lines = 0;
  if (oldTotal != null && Math.abs(oldTotal - total) > 0.005) {
    const a = await query('UPDATE invoice_items SET cost = $3 WHERE upper(sku) = $1 AND cost = $2 RETURNING id', [up(sku), oldTotal, total]).catch(() => ({ rows: [] }));
    const b = await query('UPDATE order_items SET cost = $3 WHERE upper(sku) = $1 AND cost = $2 RETURNING id', [up(sku), oldTotal, total]).catch(() => ({ rows: [] }));
    lines = a.rows.length + b.rows.length;
  }
  return { totalCost: total, linesUpdated: lines };
}

export async function addPartCost({ sku, partName, partNumber, supplier, amount, orderedOn, note, adoptExisting = false }, by, deps = defaultDeps) {
  const name = clean(partName, 160);
  if (!String(sku || '').trim()) throw new PartCostError('Pick the unit this part went on.');
  if (!name) throw new PartCostError('Say what the part is, like "ice maker" or "control board".');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new PartCostError('Enter what the part cost, before tax, as a number above zero.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(orderedOn || '') ? orderedOn : torontoToday();
  if (day > torontoToday()) throw new PartCostError('The order date cannot be in the future.');
  const mutate = async (client) => {
    await client.query(
      `INSERT INTO unit_part_costs (sku, part_name, part_number, supplier, amount, ordered_on, source, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'admin',$7,$8)`,
      [String(sku).trim(), name, clean(partNumber, 80), clean(supplier, 120), round2(amt), day, clean(note, 300), by || null]);
  };
  mutate.by = by;
  return changeParts(sku, mutate, { adoptExisting, deps });
}

export async function voidPartCost(id, by, { deps = defaultDeps } = {}) {
  const { rows } = await query('SELECT sku, voided_at FROM unit_part_costs WHERE id = $1', [Number(id)]);
  if (!rows.length) throw new PartCostError('No such part entry.');
  if (rows[0].voided_at) throw new PartCostError('That entry is already voided.');
  const mutate = async (client) => {
    await client.query('UPDATE unit_part_costs SET voided_at = now(), voided_by = $2 WHERE id = $1', [Number(id), by || null]);
  };
  mutate.by = by;
  return changeParts(rows[0].sku, mutate, { deps });
}
