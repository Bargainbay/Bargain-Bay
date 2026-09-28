// What we have ORDERED, as distinct from what has arrived.
//
// Stock used to enter the system only when a supplier INVOICE was uploaded.
// There was no record of what had been ordered, from whom, at what price, or
// when it was due — so nothing could be chased, nothing was ever late, and
// three-way matching was impossible.
//
// That gap produced the 2026-09-17 mess: 64 of the 114 appliances RS Ops held
// were not on the tracker, because nobody had uploaded the invoices that would
// have put them there. They sold anyway on typed lines, so nothing marked them
// sold. The NEEDS INVOICE rows, the fill requests and the Stock gaps screen all
// exist to paper over an ordering record that did not exist.
//
// The consequence is small to state and is the whole feature: AN APPLIANCE
// EXISTS IN THE SYSTEM FROM THE MOMENT IT IS ORDERED.
import { hasDb, query, withTransaction } from './db';
import { torontoToday } from './constants';
import { addIntakeLines } from './intake';

const clean = (v, max = 300) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};
const money = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const qtyOf = (v) => Math.max(1, Math.min(500, Math.round(Number(v) || 1)));

/**
 * STATUS IS DERIVED, never stored.
 *
 * Same rule as a part's on-hand and a unit's location: a stored status is a
 * second copy of what the lines already say, and the two drift the first time
 * somebody edits a line. Cancelled is the exception — that IS a decision
 * somebody made, so it is a column.
 */
export function statusOf(po) {
  if (po.cancelled_at) return 'cancelled';
  const lines = po.lines || [];
  if (!lines.length) return 'empty';
  const ordered = lines.reduce((a, l) => a + Number(l.qty || 0), 0);
  const received = lines.reduce((a, l) => a + Number(l.qty_received || 0), 0);
  if (received === 0) return 'open';
  return received >= ordered ? 'received' : 'partial';
}

export async function createPurchaseOrder({ vendor, orderNumber, orderedOn, expectedOn, note, lines = [], by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const v = clean(vendor, 200);
  if (!v) throw new Error('Which supplier?');
  const usable = (lines || []).filter((l) => l && (clean(l.make) || clean(l.model) || clean(l.description)));
  if (!usable.length) throw new Error('A purchase order needs at least one line.');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO purchase_orders (vendor, order_number, ordered_on, expected_on, note, created_by)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6) RETURNING id`,
      [v, clean(orderNumber, 100), orderedOn || null, expectedOn || null, clean(note, 2000), clean(by, 200)]
    );
    const poId = rows[0].id;
    for (const l of usable) {
      await client.query(
        `INSERT INTO purchase_order_lines (po_id, description, make, model, category, qty, unit_cost, retail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [poId, clean(l.description), clean(l.make, 100), clean(l.model, 100), clean(l.category, 100),
         qtyOf(l.qty), money(l.unitCost), money(l.retail)]
      );
    }
    return { id: poId };
  });
}

export async function getPurchaseOrder(id) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT * FROM purchase_orders WHERE id = $1', [Number(id)]);
  if (!rows.length) return null;
  const po = rows[0];
  const { rows: lines } = await query(
    'SELECT * FROM purchase_order_lines WHERE po_id = $1 ORDER BY id', [po.id]
  );
  const { rows: receipts } = await query(
    'SELECT * FROM purchase_order_receipts WHERE po_id = $1 ORDER BY received_at DESC, id DESC', [po.id]
  );
  return { ...po, lines, receipts, status: statusOf({ ...po, lines }) };
}

/**
 * Receive against a purchase order: the moment stock becomes real.
 *
 * `received` is [{ lineId, qty, serial? }]. Units are appended to the master
 * tracker through the ordinary intake path, so they are indistinguishable from
 * any other booked-in stock — except that they arrive WITH A COST, taken from
 * the line. That is what stops them becoming NEEDS INVOICE rows waiting on an
 * admin to approve a fill request.
 *
 * `append` is injectable so this can be tested without a Google Sheet. Nothing
 * in the app passes it.
 */
export async function receivePurchaseOrder(poId, received = [], { by, note, append = addIntakeLines } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error('No such purchase order.');
  if (po.cancelled_at) throw new Error('That purchase order was cancelled.');

  const byLine = new Map(po.lines.map((l) => [l.id, l]));
  const taking = (received || [])
    .map((r) => ({ line: byLine.get(Number(r.lineId)), qty: Math.round(Number(r.qty) || 0), serial: clean(r.serial, 100) }))
    .filter((r) => r.line && r.qty > 0);
  if (!taking.length) throw new Error('Nothing to receive.');

  // Built as tracker lines first, so a rejected append leaves no receipt behind.
  const unitLines = taking.map(({ line, qty, serial }) => ({
    make: line.make, model: line.model, category: line.category,
    description: line.description, qty, serial,
    vendor: po.vendor,
    // The supplier's own number names the lot, so when their invoice arrives it
    // lands on the lot that is already there rather than opening a second one.
    invoice: po.order_number || null,
    cost: line.unit_cost, retail: line.retail
  }));

  // THE APPEND HAPPENS INSIDE THE TRANSACTION, so a tracker that refuses the
  // write (a duplicate SKU, a staging deployment, no credentials) leaves the
  // purchase order untouched. The reverse order would record a receipt for
  // stock that is not on the tracker — which is the exact invisibility this
  // whole feature exists to end.
  return withTransaction(async (client) => {
    const appended = await append(unitLines, { vendor: po.vendor, invoice: po.order_number || null });
    const skus = (appended?.created || []).map((u) => u.sku || u).filter(Boolean);

    let cursor = 0;
    for (const { line, qty } of taking) {
      await client.query(
        'UPDATE purchase_order_lines SET qty_received = qty_received + $2 WHERE id = $1',
        [line.id, qty]
      );
      await client.query(
        `INSERT INTO purchase_order_receipts (po_id, line_id, qty, skus, received_by, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po.id, line.id, qty, skus.slice(cursor, cursor + qty), clean(by, 200), clean(note, 500)]
      );
      cursor += qty;
    }

    const after = await client.query(
      'SELECT qty, qty_received FROM purchase_order_lines WHERE po_id = $1', [po.id]
    );
    return {
      ok: true,
      received: taking.reduce((a, t) => a + t.qty, 0),
      skus,
      status: statusOf({ lines: after.rows })
    };
  });
}

export async function cancelPurchaseOrder(id, { by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    `UPDATE purchase_orders SET cancelled_at = now(), cancelled_by = $2
      WHERE id = $1 AND cancelled_at IS NULL RETURNING id`,
    [Number(id), clean(by, 200)]
  );
  if (!rows.length) throw new Error('No such purchase order, or it was already cancelled.');
  return { ok: true };
}

export async function listPurchaseOrders({ status = 'outstanding', limit = 100 } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT p.*,
            COALESCE(SUM(l.qty), 0)::int          AS ordered,
            COALESCE(SUM(l.qty_received), 0)::int AS received,
            COALESCE(SUM(l.qty * COALESCE(l.unit_cost, 0)), 0) AS value,
            -- COMPARED IN SQL, not in JS. The driver hands a date column back
            -- as a Date object and String(thatDate) is "Mon Sep 23 2026 …",
            -- not an ISO date, so slicing ten characters off it and comparing
            -- silently answers false for everything. Exactly the trap the CRM
            -- bucketing hit three days ago and that CLAUDE.md already names —
            -- walked into again, which is the argument for never doing date
            -- arithmetic on the JavaScript side of this boundary.
            (p.expected_on IS NOT NULL AND p.expected_on < $2::date) AS past_due
       FROM purchase_orders p LEFT JOIN purchase_order_lines l ON l.po_id = p.id
      GROUP BY p.id ORDER BY p.expected_on NULLS LAST, p.id DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500), torontoToday()]
  ).catch(() => ({ rows: [] }));

  const shaped = rows.map((r) => {
    const st = r.cancelled_at ? 'cancelled'
      : !r.ordered ? 'empty'
        : r.received === 0 ? 'open'
          : r.received >= r.ordered ? 'received' : 'partial';
    return {
      ...r,
      status: st,
      outstanding: Math.max(0, r.ordered - r.received),
      // LATE is only meaningful for something still owed. A fully received order
      // whose date has passed is not late; it arrived.
      late: st !== 'cancelled' && st !== 'received' && !!r.past_due
    };
  });

  if (status === 'all') return shaped;
  if (status === 'outstanding') return shaped.filter((p) => p.status === 'open' || p.status === 'partial');
  return shaped.filter((p) => p.status === status);
}

/**
 * What is owed to us — the chase list, which is the thing that did not exist.
 * Late first, because that is the only part anybody has to act on today.
 */
export async function outstandingSummary() {
  const list = await listPurchaseOrders({ status: 'outstanding', limit: 500 });
  const late = list.filter((p) => p.late);
  return {
    orders: list.length,
    units: list.reduce((a, p) => a + p.outstanding, 0),
    late: late.length,
    lateUnits: late.reduce((a, p) => a + p.outstanding, 0),
    list
  };
}
