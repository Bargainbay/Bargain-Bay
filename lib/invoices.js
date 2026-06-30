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

// items: [{ description, amount, sku?, kind?, warrantyMonths? }] amount in DOLLARS (CAD).
//   kind: 'service' for non-product lines (Installation/Delivery/Door Removal) —
//         these never carry a SKU or a warranty and don't touch inventory.
//   warrantyMonths: 3 | 6 | 12 (shown on the invoice), null for services.
// sendEmail: email the invoice to the customer (default true); false = create only.
// Fulfilment fields (deliveryMethod/address/city/postal/phone) flow into the order
// created when the invoice is marked paid.
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo, deliveryMethod, address, city, postal, phone, sendEmail = true }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  await ensureInvoiceSchema();

  const WARRANTY = new Set([3, 6, 12]);
  const lineItems = (items || [])
    .map((it) => {
      const service = it.kind === 'service';
      const wm = Number(it.warrantyMonths);
      return {
        description: String(it.description || '').trim().slice(0, 500),
        amount: round2(Number(it.amount)),
        sku: service ? null : (String(it.sku || '').trim() || null),
        kind: service ? 'service' : 'unit',
        warrantyMonths: service ? null : (WARRANTY.has(wm) ? wm : null)
      };
    })
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);
  const days = Math.min(Math.max(parseInt(daysUntilDue, 10) || 14, 1), 90);

  const invoice = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO invoices (email, name, status, subtotal, hst, total, memo, due_date,
                             delivery_method, address, city, postal, phone)
       VALUES ($1,$2,'open',$3,$4,$5,$6, (now() + ($7 || ' days')::interval)::date,$8,$9,$10,$11,$12)
       RETURNING id`,
      [email, name || null, subtotal, hst, total, memo || null, String(days),
       deliveryMethod === 'delivery' ? 'delivery' : 'pickup', address || null, city || null, postal || null, phone || null]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE invoices SET number = 'INV-' || (1000 + id) WHERE id = $1 RETURNING number, due_date`,
      [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount, kind, warranty_months) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, li.description, li.sku, li.amount, li.kind, li.warrantyMonths]
      );
    }
    return { id, number: num[0].number, dueDate: num[0].due_date, name, email, subtotal, hst, total, memo, items: lineItems };
  });

  // Email the customer their invoice + e-transfer instructions, unless the owner
  // opted out (e.g. an in-person sale). Best-effort — never fail the create if
  // mail hiccups; the owner still has the record.
  if (sendEmail) sendInvoiceEmail(invoice).catch((e) => console.error('invoice email failed', e.message));

  return { id: invoice.id, number: invoice.number, total, status: 'open', email, emailed: !!sendEmail, hostedUrl: hostedPath(invoice.number) };
}

export async function listInvoices(limit = 25) {
  if (!hasDb()) return [];
  await ensureInvoiceSchema();
  const { rows } = await query(
    `SELECT i.id, i.number, i.email, i.name, i.status, i.total, i.payment_method, i.due_date, i.paid_at, i.created_at,
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
  const { rows } = await query('SELECT * FROM invoices WHERE number = $1', [number]);
  if (!rows.length) return null;
  const inv = rows[0];
  const { rows: items } = await query(
    'SELECT id, description, sku, amount, kind, warranty_months FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [inv.id]
  );
  return { ...inv, items };
}

// Mark an open invoice paid (e-transfer / cash / etc.) and record how. Also
// records any linked units in the sold ledger (drops them off the storefront +
// onto the reconciliation list). Idempotent: paying an already-paid invoice no-ops.
export async function markInvoicePaid(invoiceId, methodKey) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureInvoiceSchema();
  const label = PAYMENT_METHODS[methodKey] || 'Other';
  const { rows } = await query(
    `UPDATE invoices SET status = 'paid', payment_method = $2, paid_at = now()
      WHERE id = $1 AND status = 'open' RETURNING id, number, total`,
    [invoiceId, label]
  );
  if (!rows.length) {
    const { rows: ex } = await query('SELECT id, number, status FROM invoices WHERE id = $1', [invoiceId]);
    if (!ex.length) throw new Error('Invoice not found.');
    return { id: ex[0].id, number: ex[0].number, status: ex[0].status, method: label, soldSkus: 0 };
  }

  let soldSkus = 0;
  try {
    const { rows: its } = await query('SELECT sku, amount FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL', [invoiceId]);
    const prices = Object.fromEntries(its.map((x) => [x.sku, Number(x.amount) || null]));
    const r = await markUnitsSold(its.map((x) => x.sku), { channel: 'invoice', ref: rows[0].number, prices });
    soldSkus = r.sold;
  } catch (e) {
    console.error('markUnitsSold (invoice) failed', e.message);
  }

  // Bridge into fulfilment: create a confirmed order so the sale enters Operations.
  // Guarded by invoices.order_id so re-runs can't duplicate it. Best-effort — a
  // failure here must not block the (already-recorded) payment.
  let orderNumber = null;
  try {
    const { rows: inv } = await query(
      `SELECT number, name, email, phone, delivery_method, address, city, postal, subtotal, hst, total, order_id
         FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    const iv = inv[0];
    if (iv && !iv.order_id) {
      const { rows: lines } = await query('SELECT description, sku, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoiceId]);
      const order = await createOrderFromInvoice({
        invoiceNumber: iv.number, email: iv.email, name: iv.name, phone: iv.phone,
        deliveryMethod: iv.delivery_method, address: iv.address, city: iv.city, postal: iv.postal,
        subtotal: iv.subtotal, hst: iv.hst, total: iv.total, paymentMethod: label,
        items: lines.map((l) => ({ sku: l.sku || null, title: l.description, price: l.amount }))
      });
      orderNumber = order.orderNumber;
      await query('UPDATE invoices SET order_id = $2 WHERE id = $1', [invoiceId, order.id]);
    } else if (iv?.order_id) {
      const { rows: o } = await query('SELECT order_number FROM orders WHERE id = $1', [iv.order_id]);
      orderNumber = o[0]?.order_number || null;
    }
  } catch (e) {
    console.error('invoice→order bridge failed', e.message);
  }

  return { id: rows[0].id, number: rows[0].number, status: 'paid', method: label, soldSkus, orderNumber };
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
