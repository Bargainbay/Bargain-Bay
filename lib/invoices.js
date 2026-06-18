// Manual invoicing — DB-backed, no payment processor. The owner builds an
// invoice in /admin/invoices; the customer is emailed an itemized invoice and
// pays by Interac e-transfer (auto-deposit) or in person. The owner marks it
// paid when the money lands, which also records the units in the sold ledger.
// (Replaced the old Stripe Invoicing flow after Stripe paused the account.)
import { hasDb, query, withTransaction } from './db';
import { round2, HST_RATE } from './constants';
import { markUnitsSold } from './catalog-sync';
import { sendInvoiceEmail } from './email';

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

// items: [{ description, amount, sku? }] where amount is in DOLLARS (CAD).
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo }) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');

  const lineItems = (items || [])
    .map((it) => ({
      description: String(it.description || '').trim().slice(0, 500),
      amount: round2(Number(it.amount)),
      sku: String(it.sku || '').trim() || null
    }))
    .filter((li) => li.description && li.amount > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  const subtotal = round2(lineItems.reduce((a, li) => a + li.amount, 0));
  const hst = addHst ? round2(subtotal * HST_RATE) : 0;
  const total = round2(subtotal + hst);
  const days = Math.min(Math.max(parseInt(daysUntilDue, 10) || 14, 1), 90);

  const invoice = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO invoices (email, name, status, subtotal, hst, total, memo, due_date)
       VALUES ($1,$2,'open',$3,$4,$5,$6, (now() + ($7 || ' days')::interval)::date)
       RETURNING id`,
      [email, name || null, subtotal, hst, total, memo || null, String(days)]
    );
    const id = rows[0].id;
    const { rows: num } = await client.query(
      `UPDATE invoices SET number = 'INV-' || (1000 + id) WHERE id = $1 RETURNING number, due_date`,
      [id]
    );
    for (const li of lineItems) {
      await client.query(
        'INSERT INTO invoice_items (invoice_id, description, sku, amount) VALUES ($1,$2,$3,$4)',
        [id, li.description, li.sku, li.amount]
      );
    }
    return { id, number: num[0].number, dueDate: num[0].due_date, name, email, subtotal, hst, total, memo, items: lineItems };
  });

  // Email the customer their invoice + e-transfer instructions (best-effort —
  // don't fail the create if mail hiccups; the owner still has the record).
  sendInvoiceEmail(invoice).catch((e) => console.error('invoice email failed', e.message));

  return { id: invoice.id, number: invoice.number, total, status: 'open', email, hostedUrl: hostedPath(invoice.number) };
}

export async function listInvoices(limit = 25) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, number, email, name, status, total, payment_method, due_date, paid_at, created_at
       FROM invoices ORDER BY created_at DESC LIMIT $1`,
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
    'SELECT id, description, sku, amount FROM invoice_items WHERE invoice_id = $1 ORDER BY id',
    [inv.id]
  );
  return { ...inv, items };
}

// Mark an open invoice paid (e-transfer / cash / etc.) and record how. Also
// records any linked units in the sold ledger (drops them off the storefront +
// onto the reconciliation list). Idempotent: paying an already-paid invoice no-ops.
export async function markInvoicePaid(invoiceId, methodKey) {
  if (!hasDb()) throw new Error('Database not configured.');
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
    const { rows: its } = await query('SELECT sku FROM invoice_items WHERE invoice_id = $1 AND sku IS NOT NULL', [invoiceId]);
    const r = await markUnitsSold(its.map((x) => x.sku), { channel: 'invoice', ref: rows[0].number, price: Number(rows[0].total) || null });
    soldSkus = r.sold;
  } catch (e) {
    console.error('markUnitsSold (invoice) failed', e.message);
  }
  return { id: rows[0].id, number: rows[0].number, status: 'paid', method: label, soldSkus };
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
