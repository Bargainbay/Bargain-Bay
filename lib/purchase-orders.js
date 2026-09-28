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
import { linkByVendorName } from './suppliers';

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
    // Attach it to the supplier master by the name already typed on it. Silent
    // and best-effort: a name that matches nothing leaves supplier_id null and
    // turns up on `unknownVendorNames`, because failing to recognise a name
    // must never stop a purchase order being raised.
    await linkByVendorName('purchase_orders', poId, v).catch(() => {});
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

// ---------------------------------------------------------------------------
// THREE-WAY MATCHING: what we ordered, what arrived, what we were billed.
//
// HEADER LEVEL, and that is a real limitation rather than an oversight.
// `purchase_invoices` records a vendor, a number, a date, a subtotal, a tax
// figure, a total and a UNIT COUNT — there is no line-item table, because
// intake parses the PDF's lines straight into tracker units and keeps only the
// header for the HST input tax credit.
//
// So this compares totals and counts, not line against line. It cannot tell you
// that one fridge on a six-line invoice was priced wrong. It can tell you an
// invoice arrived for stock nobody ordered, that stock arrived nobody has
// billed us for, that the counts disagree, or that the money does.

/** Value agreed on the order: what we said we would pay, before tax. */
const orderedValue = (lines) =>
  lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);

/**
 * The comparison for one purchase order.
 *
 * `problems` is the point. An empty array means the three agree; anything in it
 * is money or stock unaccounted for, stated plainly enough to act on.
 */
export async function matchPurchaseOrder(poId) {
  if (!hasDb()) return null;
  const po = await getPurchaseOrder(poId);
  if (!po) return null;

  const { rows: invs } = await query(
    `SELECT id, vendor, invoice_number, invoice_date, subtotal, tax, total, units
       FROM purchase_invoices WHERE po_id = $1 ORDER BY invoice_date, id`, [po.id]
  ).catch(() => ({ rows: [] }));

  const ordered = po.lines.reduce((a, l) => a + Number(l.qty || 0), 0);
  const received = po.lines.reduce((a, l) => a + Number(l.qty_received || 0), 0);
  const invoicedUnits = invs.reduce((a, i) => a + Number(i.units || 0), 0);
  const value = Math.round(orderedValue(po.lines) * 100) / 100;
  // Subtotal, not total: we compare what we AGREED TO PAY against what we were
  // charged for the goods. The tax on top is reclaimed, not spent.
  const invoicedValue = Math.round(invs.reduce((a, i) => a + Number(i.subtotal || 0), 0) * 100) / 100;

  const problems = [];
  if (received > 0 && !invs.length) {
    problems.push({
      kind: 'received_not_invoiced', severity: 'high',
      text: `${received} unit(s) booked in and no supplier invoice recorded — their cost is not in the books and no HST has been reclaimed on them.`
    });
  }
  if (invs.length && invoicedUnits && invoicedUnits !== received) {
    problems.push({
      kind: 'count_mismatch', severity: invoicedUnits > received ? 'high' : 'low',
      text: invoicedUnits > received
        ? `Billed for ${invoicedUnits} but only ${received} arrived.`
        : `${received} arrived but only ${invoicedUnits} billed — an invoice may still be coming.`
    });
  }
  // A cent or two is rounding; anything more was a decision somebody made.
  if (invs.length && value > 0 && Math.abs(invoicedValue - value) > 1) {
    problems.push({
      kind: 'value_mismatch', severity: invoicedValue > value ? 'high' : 'low',
      text: `Agreed ${value.toFixed(2)}, billed ${invoicedValue.toFixed(2)} — a difference of ${(invoicedValue - value).toFixed(2)}.`
    });
  }

  return {
    po: { id: po.id, vendor: po.vendor, orderNumber: po.order_number, status: po.status },
    ordered, received, invoicedUnits,
    value, invoicedValue,
    invoices: invs,
    problems,
    // Header-level. Said out loud on the screen too, so nobody reads a clean
    // match as "every line was priced correctly".
    headerLevelOnly: true
  };
}

/**
 * Link an invoice to the order it bills. Explicit — nothing links automatically.
 *
 * A wrong link makes two sets of books disagree quietly, and matching on a
 * number that "looks like" the order's is exactly how the S-ORD115612 /
 * PS-INV116968 tangle happened. `suggestPurchaseOrderForInvoice` proposes; a
 * person confirms.
 */
export async function linkInvoiceToPurchaseOrder(invoiceId, poId, { by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const id = Number(invoiceId);
  const po = poId === null ? null : Number(poId);
  if (!id) throw new Error('Which invoice?');
  if (po) {
    const { rows } = await query('SELECT id FROM purchase_orders WHERE id = $1', [po]);
    if (!rows.length) throw new Error('No such purchase order.');
  }
  const { rows } = await query(
    `UPDATE purchase_invoices
        SET po_id = $2, linked_by = $3, linked_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END
      WHERE id = $1 RETURNING id, po_id`,
    [id, po, clean(by, 200)]
  );
  if (!rows.length) throw new Error('No such invoice.');
  return { ok: true, invoiceId: id, poId: rows[0].po_id };
}

/**
 * Orders this invoice might belong to.
 *
 * Suggests on the supplier's own order number first — the strongest signal we
 * have and the one the tracker lot is already named after — then falls back to
 * that vendor's open orders. It never picks one.
 */
export async function suggestPurchaseOrderForInvoice(invoiceId) {
  if (!hasDb()) return [];
  const { rows: inv } = await query(
    'SELECT vendor, invoice_number FROM purchase_invoices WHERE id = $1', [Number(invoiceId)]
  ).catch(() => ({ rows: [] }));
  if (!inv.length) return [];

  const vendor = String(inv[0].vendor || '').trim().toLowerCase();
  const number = String(inv[0].invoice_number || '').trim().toLowerCase();

  const { rows } = await query(
    `SELECT p.id, p.vendor, p.order_number, p.expected_on,
            COALESCE(SUM(l.qty), 0)::int AS ordered,
            COALESCE(SUM(l.qty_received), 0)::int AS received,
            (p.order_number IS NOT NULL AND $2 <> '' AND lower(p.order_number) = $2) AS exact
       FROM purchase_orders p LEFT JOIN purchase_order_lines l ON l.po_id = p.id
      WHERE p.cancelled_at IS NULL AND lower(p.vendor) = $1
      GROUP BY p.id ORDER BY exact DESC, p.id DESC LIMIT 10`,
    [vendor, number]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * The two lists worth looking at, and both are money.
 *
 *   unbilled  — stock booked in against an order with no invoice recorded. Its
 *               cost is not in the books and no HST has been reclaimed on it.
 *   unmatched — an invoice belonging to no order at all: either somebody bought
 *               outside the process, or an order was never raised for it.
 */
export async function matchingGaps({ limit = 100 } = {}) {
  if (!hasDb()) return { unbilled: [], unmatched: [] };
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const { rows: unbilled } = await query(
    `SELECT p.id, p.vendor, p.order_number, p.expected_on,
            COALESCE(SUM(l.qty_received), 0)::int AS received,
            COALESCE(SUM(l.qty_received * COALESCE(l.unit_cost, 0)), 0) AS value
       FROM purchase_orders p JOIN purchase_order_lines l ON l.po_id = p.id
      WHERE p.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.po_id = p.id)
      GROUP BY p.id HAVING COALESCE(SUM(l.qty_received), 0) > 0
      ORDER BY value DESC LIMIT $1`, [cap]
  ).catch(() => ({ rows: [] }));

  const { rows: unmatched } = await query(
    `SELECT id, vendor, invoice_number, invoice_date, subtotal, total, units
       FROM purchase_invoices WHERE po_id IS NULL
      ORDER BY invoice_date DESC, id DESC LIMIT $1`, [cap]
  ).catch(() => ({ rows: [] }));

  return {
    unbilled,
    unbilledValue: Math.round(unbilled.reduce((a, r) => a + Number(r.value || 0), 0) * 100) / 100,
    unmatched,
    unmatchedValue: Math.round(unmatched.reduce((a, r) => a + Number(r.subtotal || 0), 0) * 100) / 100
  };
}
