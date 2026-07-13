// Manual invoicing — DB-backed, no payment processor. The owner builds an
// invoice in /admin/invoices; the customer is emailed an itemized invoice and
// pays by Interac e-transfer (auto-deposit) or in person. The owner marks it
// paid when the money lands, which also records the units in the sold ledger.
// (Replaced the old Stripe Invoicing flow after Stripe paused the account.)
import { hasDb, query, withTransaction } from './db';
import { round2, HST_RATE } from './constants';
import { markUnitsSold } from './catalog-sync';
import { sendInvoiceEmail } from './email';
import { createOrderFromInvoice } from './orders';
import { upsertCustomer } from './customers';

// Self-provision the fulfilment columns added for the invoice→order bridge, so
// it works on deploy without a manual migration (mirrors db/schema.sql). Cached.
let _invSchema = null;
function ensureInvoiceSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_invSchema) {
    _invSchema = query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_method text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS address  text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS city     text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS postal   text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phone    text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int;
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text;            -- 'unit' (default) | 'service'
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warranty_months int;  -- 3 | 6 | 12, null = no warranty
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- captured unit cost when not in the tracker
      ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- effective unit cost on the sale (overrides products.cost)
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_at timestamptz;   -- set when a paid invoice is refunded
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_at timestamptz; -- set per line on a partial (per-unit) refund
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0; -- money returned so far (incl. HST share)
      -- Allow the 'refunded' status (the original CHECK only permitted open/paid/void).
      ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
      ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
        CHECK (status IN ('open','paid','void','refunded'));
      -- An invoice line can be a service/fee with no unit SKU (Delivery, Install,
      -- ad-hoc). Those must still flow into an order, so order_items.sku must be
      -- nullable — the original NOT NULL silently broke the invoice→order bridge
      -- for any invoice containing a non-inventory line.
      ALTER TABLE order_items ALTER COLUMN sku DROP NOT NULL;
    `).catch((e) => { _invSchema = null; throw e; });
  }
  return _invSchema;
}

// How a payment was taken.
export const PAYMENT_METHODS = {
  cash: 'Cash',
  etransfer: 'E-transfer',
  card: 'Card (manual)',
  cheque: 'Cheque',
  other: 'Other'
};

function hostedPath(number) {
  return number ? `/invoice/${encodeURIComponent(number)}` : null;
}

// Business days run on Toronto time everywhere else (dashboard bucketing), so
// backdates do too.
function torontoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); // YYYY-MM-DD
}

// Validate an owner-supplied backdate ('YYYY-MM-DD'). Returns the date string,
// or null when it's absent/today (caller falls back to now() — keeps the exact
// timestamp on the normal same-day flow). Future dates and anything older than
// two years are rejected rather than silently clamped.
function normalizeBackdate(input, label = 'date') {
  const s = String(input || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`The ${label} must be a date like 2026-07-08.`);
  const today = torontoToday();
  if (s > today) throw new Error(`The ${label} can't be in the future.`);
  const floor = new Date(Date.now() - 2 * 366 * 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  if (s < floor) throw new Error(`The ${label} can't be more than two years back.`);
  return s === today ? null : s;
}

// SQL fragment: a 'YYYY-MM-DD' param rendered as noon Toronto time, so the
// timestamp lands mid-day in every dashboard bucket regardless of DST/UTC edges.
const NOON_TORONTO = (param) => `((${param}::text || ' 12:00')::timestamp AT TIME ZONE 'America/Toronto')`;

// items: [{ description, amount, sku?, kind?, warrantyMonths? }] amount in DOLLARS (CAD).
//   kind: 'service' for non-product lines (Installation/Delivery/Door Removal) —
//         these never carry a SKU or a warranty and don't touch inventory.
//   warrantyMonths: 3 | 6 | 12 (shown on the invoice), null for services.
// sendEmail: email the invoice to the customer (default true); false = create only.
// invoiceDate: optional 'YYYY-MM-DD' backdate for a sale that was rung up late —
//   sets the invoice's issued date (and due date counts from it). Revenue lands on
//   the PAID date, so pass the real date to markInvoicePaid too.
// Fulfilment fields (deliveryMethod/address/city/postal/phone) flow into the order
// created when the invoice is marked paid.
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo, deliveryMethod, address, city, postal, phone, sendEmail = true, invoiceDate }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureInvoiceSchema();
  const backdate = normalizeBackdate(invoiceDate, 'invoice date');

  const WARRANTY = new Set([3, 6, 12]);
  const lineItems = (items || [])
    .map((it) => {
      const service = it.kind === 'service';
      const wm = Number(it.warrantyMonths);
      const cost = Number(it.cost);
      return {
        description: String(it.description || '').trim().slice(0, 500),
        amount: round2(Number(it.amount)),
        sku: service ? null : (String(it.sku || '').trim() || null),
        kind: service ? 'service' : 'unit',
        warrantyMonths: service ? null : (WARRANTY.has(wm) ? wm : null),
        // Captured unit cost (for a unit not cost-linked in the catalog) so margin
        // is right. null for services / when not supplied.
        cost: service ? null : (Number.isFinite(cost) && cost >= 0 ? round2(cost) : null)
      };
    })
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);
  const days = Math.min(Math.max(parseInt(daysUntilDue, 10) || 14, 1), 90);

  const invoice = await withTransaction(async (client) => {
    // A backdated invoice gets created_at = noon Toronto on that day (so it sorts
    // and displays as issued then) and its due date counts from that day too.
    const { rows } = await client.query(
      `INSERT INTO invoices (email, name, status, subtotal, hst, total, memo, due_date,
                             delivery_method, address, city, postal, phone, created_at)
       VALUES ($1,$2,'open',$3,$4,$5,$6,
               (COALESCE($13::date, (now() AT TIME ZONE 'America/Toronto')::date) + ($7 || ' days')::interval)::date,
               $8,$9,$10,$11,$12, COALESCE(${NOON_TORONTO('$13')}, now()))
       RETURNING id`,
      [email, name || null, subtotal, hst, total, memo || null, String(days),
       deliveryMethod === 'delivery' ? 'delivery' : 'pickup', address || null, city || null, postal || null, phone || null,
       backdate]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE invoices SET number = 'INV-' || (1000 + id) WHERE id = $1 RETURNING number, due_date`,
      [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, warranty_months, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, li.description, li.sku, li.amount, li.kind, li.warrantyMonths, li.cost]
      );
    }
    return { id, number: num[0].number, dueDate: num[0].due_date, name, email, subtotal, hst, total, memo,
             deliveryMethod: deliveryMethod === 'delivery' ? 'delivery' : 'pickup', address, city, postal, phone,
             items: lineItems };
  });

  // Email the customer their invoice + e-transfer instructions, unless the owner
  // opted out (e.g. an in-person sale). Best-effort — never fail the create if
  // mail hiccups; the owner still has the record.
  if (sendEmail) sendInvoiceEmail(invoice).catch((e) => console.error('invoice email failed', e.message));

  // Fold the invoiced client into the customer database. Best-effort.
  upsertCustomer({ email, name, phone, address, city, postal })
    .catch((e) => console.error('customer upsert failed', e.message));

  return { id: invoice.id, number: invoice.number, total, status: 'open', email, emailed: !!sendEmail, hostedUrl: hostedPath(invoice.number) };
}

// A customer's own invoices, for their account page.
export async function invoicesForEmail(email) {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT id, number, status, total, refund_total, due_date, created_at FROM invoices
      WHERE lower(email) = lower($1) AND number IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
    [String(email || '').trim()]
  );
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, total: Number(r.total) || 0,
    refunded: Number(r.refund_total || 0),
    due: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

// Lightweight observability for ops/monitoring: how invoices and orders break
// down by status, and whether each paid invoice has its fulfilment order. No
// customer data — just counts, so it's safe to surface in the cron response.
export async function invoiceOrderStats() {
  if (!hasDb()) return null;
  await ensureInvoiceSchema();
  const inv = (await query("SELECT status, COUNT(*) c FROM invoices GROUP BY status").catch(() => ({ rows: [] }))).rows;
  const ord = (await query("SELECT status, COUNT(*) c FROM orders GROUP BY status").catch(() => ({ rows: [] }))).rows;
  const paidNoOrder = (await query("SELECT COUNT(*) c FROM invoices WHERE status='paid' AND order_id IS NULL").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  const paidWithOrder = (await query("SELECT COUNT(*) c FROM invoices WHERE status='paid' AND order_id IS NOT NULL").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  const fromInvoices = (await query("SELECT COUNT(*) c FROM orders WHERE notes LIKE 'Created from invoice%'").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c;
  return {
    invoicesByStatus: Object.fromEntries(inv.map((r) => [r.status, Number(r.c)])),
    ordersByStatus: Object.fromEntries(ord.map((r) => [r.status, Number(r.c)])),
    paidInvoicesWithOrder: Number(paidWithOrder),
    paidInvoicesMissingOrder: Number(paidNoOrder),
    ordersFromInvoices: Number(fromInvoices)
  };
}

export async function listInvoices(limit = 25) {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT i.id, i.number, i.email, i.name, i.status, i.total, i.refund_total, i.payment_method, i.due_date, i.paid_at, i.created_at,
            o.order_number AS order_number
       FROM invoices i
       LEFT JOIN orders o ON o.id = i.order_id
      ORDER BY i.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number || '(draft)',
    email: r.email,
    name: r.name,
    total: Number(r.total) || 0,
    refundedTotal: Number(r.refund_total) || 0,
    status: r.status,
    method: r.payment_method,
    hostedUrl: hostedPath(r.number),
    orderNumber: r.order_number || null,
    due: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    created: r.created_at ? r.created_at.toISOString() : null
  }));
}

export async function getInvoiceByNumber(number) {
  if (!hasDb()) return null;
  await ensureInvoiceSchema(); // items select includes refunded_at — make sure it exists
  const { rows } = await query('SELECT * FROM invoices WHERE number = $1', [number]);
  if (!rows.length) return null;
  const inv = rows[0];
  const { rows: items } = await query(
    'SELECT id, description, sku, amount, kind, warranty_months, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [inv.id]
  );
  return { ...inv, items };
}

// Mark an invoice paid (e-transfer / cash / etc.) and record how. Marking paid
// ALWAYS registers the sale as confirmed revenue: it delists the units and
// guarantees a confirmed fulfilment order exists (that order is what the revenue
// dashboard counts). This holds no matter the path — a fresh open→paid flip, an
// invoice created and paid in one go, or re-confirming one that's already paid.
// The order step is idempotent (invoices.order_id) so it never duplicates.
// paidDate: optional 'YYYY-MM-DD' — when the money actually landed (backdated
// sale). The bridged order is dated to paid_at, so this is what puts the revenue
// on the right day. On an ALREADY-paid invoice a paidDate re-dates the payment
// (and moves its order), fixing a sale recorded on the wrong day.
export async function markInvoicePaid(invoiceId, methodKey, paidDate) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const label = PAYMENT_METHODS[methodKey] || 'Other';
  const backdate = normalizeBackdate(paidDate, 'payment date');

  // Flip open→paid (records method + paid_at). If it was already paid this is a
  // no-op, but we still ensure the order below so the sale always counts.
  const { rows: flip } = await query(
    `UPDATE invoices SET status = 'paid', payment_method = $2,
            paid_at = COALESCE(${NOON_TORONTO('$3')}, now())
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [invoiceId, label, backdate]
  );
  const justPaid = flip.length > 0;

  const { rows: cur } = await query('SELECT id, number, status, order_id FROM invoices WHERE id = $1', [invoiceId]);
  if (!cur.length) throw new Error('Invoice not found.');
  const iv = cur[0];
  // A void/refunded invoice can't be "paid" — surface its state, change nothing.
  if (iv.status !== 'paid') {
    return { id: iv.id, number: iv.number, status: iv.status, method: label, soldSkus: 0, orderNumber: null };
  }

  // Re-dating an already-paid invoice: move paid_at and keep its bridged order
  // (what the dashboard counts) on the same day.
  if (!justPaid && backdate) {
    await query(`UPDATE invoices SET paid_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [invoiceId, backdate]);
    if (iv.order_id) {
      await query(`UPDATE orders SET created_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [iv.order_id, backdate]).catch(() => {});
    }
  }

  // Delist the units (only on the actual flip — they're already sold on a re-mark).
  let soldSkus = 0;
  if (justPaid) {
    try {
      const { rows: its } = await query('SELECT sku, amount FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL', [invoiceId]);
      const prices = Object.fromEntries(its.map((x) => [x.sku, Number(x.amount) || null]));
      const r = await markUnitsSold(its.map((x) => x.sku), { channel: 'invoice', ref: iv.number, prices });
      soldSkus = r.sold;
    } catch (e) {
      console.error('markUnitsSold (invoice) failed', e.message);
    }
  }

  // ALWAYS ensure the confirmed fulfilment order exists — this is what the
  // dashboard counts, so "marked paid" must equal "confirmed revenue". Idempotent
  // via invoices.order_id; best-effort so a hiccup never blocks the payment record
  // (the per-invoice "+ Add to dashboard" / Sync button is the retry safety net).
  let orderNumber = null;
  try {
    const r = await backfillInvoiceOrder(invoiceId);
    orderNumber = r.orderNumber;
  } catch (e) {
    console.error('invoice→order bridge failed', e.message);
  }

  return { id: iv.id, number: iv.number, status: 'paid', method: label, soldSkus, orderNumber };
}

// Void an open invoice (created in error). Leaves a record; doesn't touch stock.
export async function voidInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows } = await query(
    "UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'open' RETURNING id, number",
    [invoiceId]
  );
  return rows[0] || null;
}

// Refund a PAID invoice (customer returned the item / sale reversed). Relists
// each unit on the storefront and cancels the linked fulfilment order
// then marks the invoice 'refunded'. Crucially it cancels the invoice's OWN
// bridged order directly (so refunded money stops counting as revenue even when
// the invoice is service-only / has no SKU lines), and relists only this
// invoice's units (not every order that happens to share a SKU). Idempotent:
// refunding a non-paid invoice no-ops and reports its current status.
export async function refundInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query(
    `UPDATE invoices SET status = 'refunded', refunded_at = now(), refund_total = total
      WHERE id = $1 AND status = 'paid' RETURNING id, number, total, order_id`,
    [invoiceId]
  );
  if (!rows.length) {
    const { rows: ex } = await query('SELECT id, number, status FROM invoices WHERE id = $1', [invoiceId]);
    if (!ex.length) throw new Error('Invoice not found.');
    if (ex[0].status === 'refunded') return { id: ex[0].id, number: ex[0].number, status: 'refunded', relisted: 0, orderCancelled: false };
    throw new Error('Only a paid invoice can be refunded.');
  }
  const inv = rows[0];

  // Cancel this invoice's OWN fulfilment order (whatever its line kinds) so the
  // sale leaves the revenue counts, and release any reservations it held.
  let orderCancelled = false;
  if (inv.order_id) {
    try {
      const c = await query("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' RETURNING id", [inv.order_id]);
      if (c.rowCount) {
        orderCancelled = true;
        await query('DELETE FROM reservations WHERE order_id = $1', [inv.order_id]).catch(() => {});
      }
    } catch (e) {
      console.error('refund order-cancel failed', e.message);
    }
  }

  // Relist this invoice's unit(s) on the storefront — product-level only, scoped
  // to its own SKUs (does NOT touch other orders that share a SKU).
  let relisted = 0;
  try {
    const { rows: its } = await query(
      "SELECT sku FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL AND COALESCE(kind,'unit') <> 'service'",
      [invoiceId]
    );
    const skus = [...new Set(its.map((x) => x.sku).filter(Boolean))];
    if (skus.length) {
      const r = await query(
        `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                             sold_ref = null, tracker_synced = false, synced_at = now()
          WHERE sku = ANY($1)`,
        [skus]
      );
      relisted = r.rowCount || 0;
    }
  } catch (e) {
    console.error('refundInvoice relist failed', e.message);
  }
  // Stamp every line refunded so the hosted invoice shows them consistently with
  // partial refunds (best-effort — the invoice status is the source of truth).
  await query('UPDATE invoice_items SET refunded_at = now() WHERE invoice_id = $1 AND refunded_at IS NULL', [invoiceId]).catch(() => {});
  return { id: inv.id, number: inv.number, status: 'refunded', relisted, orderCancelled };
}

// Refund SELECTED lines of a paid invoice (per-unit refund) — e.g. one appliance
// out of a three-unit order comes back. For each refunded line: the unit is
// relisted on the storefront, and the line's amount (plus its HST share, when the
// invoice charged HST) comes OFF the bridged fulfilment order so the dashboard
// stops counting that money. The invoice keeps its original totals for the books;
// refunded lines are stamped (invoice_items.refunded_at) and the running refund
// is tracked in invoices.refund_total. Refunding the last remaining line(s)
// escalates to a full refund (status 'refunded', order cancelled).
// Select lines by itemIds (invoice_items.id) and/or skus.
export async function refundInvoiceItems(invoiceId, { itemIds = [], skus = [] } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows: ex } = await query('SELECT id, number, status, subtotal, hst, total, refund_total, order_id FROM invoices WHERE id = $1', [invoiceId]);
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (inv.status !== 'paid') throw new Error(`Only a paid invoice can be refunded (this one is ${inv.status}).`);

  const ids = [...new Set((itemIds || []).map((n) => parseInt(n, 10)).filter(Number.isFinite))];
  const wantSkus = [...new Set((skus || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length && !wantSkus.length) throw new Error('Pick at least one line to refund.');

  const { rows: all } = await query(
    'SELECT id, description, sku, amount, kind, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [invoiceId]
  );
  const lowerSkus = wantSkus.map((s) => s.toLowerCase());
  const targets = all.filter((it) => !it.refunded_at &&
    (ids.includes(it.id) || (it.sku && lowerSkus.includes(String(it.sku).toLowerCase()))));
  if (!targets.length) {
    throw new Error('None of the selected lines can be refunded — they may already be refunded. Nothing changed.');
  }

  // Every remaining line selected → this is a full refund; reuse that path so the
  // order is cancelled outright and the invoice flips to 'refunded'.
  const remaining = all.filter((it) => !it.refunded_at);
  if (targets.length === remaining.length) {
    const full = await refundInvoice(invoiceId);
    return { ...full, refundedItems: targets.length, refundAmount: Number(inv.total) - Number(inv.refund_total || 0), fullyRefunded: true };
  }

  const hasHst = Number(inv.hst) > 0;
  const refundBase = round2(targets.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  const refundHst = hasHst ? round2(refundBase * HST_RATE) : 0;
  const refundAmount = round2(refundBase + refundHst);
  const targetIds = targets.map((it) => it.id);

  await withTransaction(async (client) => {
    await client.query('UPDATE invoice_items SET refunded_at = now() WHERE id = ANY($1)', [targetIds]);
    await client.query(
      'UPDATE invoices SET refund_total = LEAST(total, round((COALESCE(refund_total,0) + $2)::numeric, 2)) WHERE id = $1',
      [invoiceId, refundAmount]
    );

    // Take the refunded lines off the bridged order so revenue/profit shrink by
    // exactly this refund. Match each order line by SKU when the invoice line has
    // one, otherwise by title+price (order lines were created verbatim from the
    // invoice lines) — one order row per refunded line.
    if (inv.order_id) {
      const { rows: ord } = await client.query("SELECT id, status FROM orders WHERE id = $1", [inv.order_id]);
      if (ord.length && ord[0].status !== 'cancelled') {
        for (const it of targets) {
          await client.query(
            `DELETE FROM order_items WHERE id = (
               SELECT id FROM order_items
                WHERE order_id = $1
                  AND ((($2::text IS NOT NULL) AND sku = $2) OR (($2::text IS NULL) AND sku IS NULL AND title = $3))
                ORDER BY abs(price - $4) ASC LIMIT 1)`,
            [inv.order_id, it.sku || null, it.description, Number(it.amount) || 0]
          );
        }
        await client.query(
          `UPDATE orders SET
             subtotal = GREATEST(0, round((subtotal - $2)::numeric, 2)),
             hst      = GREATEST(0, round((hst - $3)::numeric, 2)),
             total    = GREATEST(0, round((total - $4)::numeric, 2)),
             notes    = COALESCE(notes || E'\\n', '') || $5
           WHERE id = $1`,
          [inv.order_id, refundBase, refundHst, refundAmount,
           `Partial refund ${torontoToday()}: ${targets.map((t) => t.description).join(', ')} (−$${refundAmount.toFixed(2)})`]
        );
      }
    }
  });

  // Relist the refunded unit(s) on the storefront — same product-level relist as a
  // full refund, scoped to the refunded lines' SKUs. Best-effort, outside the txn.
  let relisted = 0;
  try {
    const refundSkus = [...new Set(targets.filter((it) => it.sku && (it.kind || 'unit') !== 'service').map((it) => it.sku))];
    if (refundSkus.length) {
      const r = await query(
        `UPDATE products SET active = true, sold_at = null, sold_price = null, sold_channel = null,
                             sold_ref = null, tracker_synced = false, synced_at = now()
          WHERE sku = ANY($1)`,
        [refundSkus]
      );
      relisted = r.rowCount || 0;
    }
  } catch (e) {
    console.error('refundInvoiceItems relist failed', e.message);
  }

  return {
    id: inv.id, number: inv.number, status: 'paid', fullyRefunded: false,
    refundedItems: targets.length, refundAmount, relisted,
    refundTotal: Math.min(Number(inv.total), round2(Number(inv.refund_total || 0) + refundAmount))
  };
}

// Permanently delete an invoice created in error. Only allowed for invoices that
// never took money (open / void) — paid invoices must be refunded, never deleted,
// so the books stay intact. Cascades to invoice_items (ON DELETE CASCADE).
export async function deleteInvoice(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { rows: ex } = await query('SELECT id, number, status, order_id FROM invoices WHERE id = $1', [invoiceId]);
  if (!ex.length) throw new Error('Invoice not found.');
  const inv = ex[0];
  if (inv.status === 'paid' || inv.status === 'refunded') {
    throw new Error('This invoice has been paid — refund it instead of deleting (keeps your records clean).');
  }
  // open / void invoices never created an order, but null the link defensively.
  await query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
  return { id: inv.id, number: inv.number, deleted: true };
}

// Edit an OPEN invoice's line items / memo / HST (add, remove, or reprice).
// Paid/refunded/void invoices are locked — editing them would desync the sold
// units and the bridged order; refund-and-reissue instead. Recomputes totals and
// replaces the items in one transaction.
export async function updateInvoice(invoiceId, { items, addHst, memo, invoiceDate }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const backdate = normalizeBackdate(invoiceDate, 'invoice date');
  const { rows: ex } = await query('SELECT id, number, status FROM invoices WHERE id = $1', [invoiceId]);
  if (!ex.length) throw new Error('Invoice not found.');
  if (ex[0].status !== 'open') {
    throw new Error(`Only an open invoice can be edited (this one is ${ex[0].status}). Refund and reissue instead.`);
  }

  const WARRANTY = new Set([3, 6, 12]);
  const lineItems = (items || [])
    .map((it) => {
      const service = it.kind === 'service';
      const wm = Number(it.warrantyMonths);
      const cost = Number(it.cost);
      return {
        description: String(it.description || '').trim().slice(0, 500),
        amount: round2(Number(it.amount)),
        sku: service ? null : (String(it.sku || '').trim() || null),
        kind: service ? 'service' : 'unit',
        warrantyMonths: service ? null : (WARRANTY.has(wm) ? wm : null),
        // Captured unit cost (for a unit not cost-linked in the catalog) so margin
        // is right. null for services / when not supplied.
        cost: service ? null : (Number.isFinite(cost) && cost >= 0 ? round2(cost) : null)
      };
    })
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);

  await withTransaction(async (client) => {
    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, warranty_months, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [invoiceId, li.description, li.sku, li.amount, li.kind, li.warrantyMonths, li.cost]
      );
    }
    await client.query(
      'UPDATE invoices SET subtotal = $2, hst = $3, total = $4, memo = $5 WHERE id = $1',
      [invoiceId, subtotal, hst, total, memo != null ? String(memo).trim() : null]
    );
    // Re-date the invoice (backdate a sale rung up late). A supplied date of
    // "today" also re-dates — that's how a backdate gets undone.
    if (backdate) {
      await client.query(`UPDATE invoices SET created_at = ${NOON_TORONTO('$2')} WHERE id = $1`, [invoiceId, backdate]);
    } else if (String(invoiceDate || '').trim()) {
      await client.query('UPDATE invoices SET created_at = now() WHERE id = $1', [invoiceId]);
    }
  });
  return { id: invoiceId, number: ex[0].number, subtotal, hst, total };
}

// Backfill the fulfilment order for a PAID invoice that never created one (e.g.
// it was marked paid before the invoice→order bridge existed, so it's invisible
// to the orders-based dashboard). Dates the order to when the invoice was paid so
// revenue lands in the right period. Idempotent via invoices.order_id.
export async function backfillInvoiceOrder(invoiceId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT id, number, name, email, phone, delivery_method, address, city, postal,
            subtotal, hst, total, payment_method, paid_at, created_at, order_id, status
       FROM invoices WHERE id = $1`,
    [invoiceId]
  );
  if (!rows.length) throw new Error('Invoice not found.');
  const iv = rows[0];
  if (iv.status !== 'paid') throw new Error(`Only a paid invoice can be added to the dashboard (this one is ${iv.status}).`);
  if (iv.order_id) {
    const { rows: o } = await query('SELECT order_number FROM orders WHERE id = $1', [iv.order_id]);
    return { number: iv.number, orderNumber: o[0]?.order_number || null, alreadyLinked: true };
  }
  const { rows: lines } = await query('SELECT description, sku, amount, cost, refunded_at FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoiceId]);
  // Skip lines already refunded (a partial refund can land before this backfill
  // runs — e.g. the original bridge errored and the nightly sweep is catching up).
  // With refunds in play the order totals are re-derived from the kept lines so
  // the dashboard never counts returned money.
  const kept = lines.filter((l) => !l.refunded_at);
  if (!kept.length) throw new Error('Every line on this invoice has been refunded — nothing to add to the dashboard.');
  const anyRefunded = kept.length !== lines.length;
  const subtotal = anyRefunded ? round2(kept.reduce((a, l) => a + (Number(l.amount) || 0), 0)) : iv.subtotal;
  const hst = anyRefunded ? (Number(iv.hst) > 0 ? round2(subtotal * HST_RATE) : 0) : iv.hst;
  const total = anyRefunded ? round2(Number(subtotal) + Number(hst)) : iv.total;
  const order = await createOrderFromInvoice({
    invoiceNumber: iv.number, email: iv.email, name: iv.name, phone: iv.phone,
    deliveryMethod: iv.delivery_method, address: iv.address, city: iv.city, postal: iv.postal,
    subtotal, hst, total, paymentMethod: iv.payment_method,
    items: kept.map((l) => ({ sku: l.sku || null, title: l.description, price: l.amount, cost: l.cost }))
  });
  // Date the order to when the money actually landed (paid_at), not "now".
  const when = iv.paid_at || iv.created_at;
  if (when) await query('UPDATE orders SET created_at = $2 WHERE id = $1', [order.id, when]).catch(() => {});
  await query('UPDATE invoices SET order_id = $2 WHERE id = $1', [invoiceId, order.id]);
  return { number: iv.number, orderNumber: order.orderNumber, alreadyLinked: false };
}

// Repair sweep: backfill orders for every paid invoice that's missing one. Returns
// what it created so the owner can see exactly which sales were re-surfaced.
export async function backfillAllInvoiceOrders() {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const { rows } = await query("SELECT id, number FROM invoices WHERE status = 'paid' AND order_id IS NULL ORDER BY id");
  const created = [];
  const failed = [];
  for (const r of rows) {
    try {
      const res = await backfillInvoiceOrder(r.id);
      if (!res.alreadyLinked && res.orderNumber) created.push({ invoice: res.number, order: res.orderNumber });
    } catch (e) {
      console.error('backfill invoice order failed', r.id, e.message);
      failed.push({ invoice: r.number, error: e.message });
    }
  }
  return { fixed: created.length, created, failed };
}

// Packing-slip view of an invoice: each unit line joined to its serial (uid) and
// condition from the catalog so the warehouse/delivery team can pick the exact
// physical unit. Services (delivery/install) are kept as plain lines. No prices.
export async function getPackingSlip(number) {
  if (!hasDb()) return null;
  await ensureInvoiceSchema();
  const { rows } = await query('SELECT * FROM invoices WHERE number = $1', [number]);
  if (!rows.length) return null;
  const inv = rows[0];
  const { rows: items } = await query(
    `SELECT ii.id, ii.description, ii.sku, ii.kind, ii.warranty_months,
            p.uid AS serial, p.condition, p.make, p.model
       FROM invoice_items ii
       LEFT JOIN products p ON p.sku = ii.sku
      WHERE ii.invoice_id = $1
        AND ii.refunded_at IS NULL  -- refunded lines aren't being shipped
      ORDER BY ii.id`,
    [inv.id]
  );
  return { ...inv, items };
}
