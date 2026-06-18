// Manual invoicing via Stripe Invoicing. Creates a hosted, payable invoice and
// emails it to the customer. Reuses the same Stripe account as checkout.
//
// NOTE: the API key needs write access to Customers, Invoice Items, and Invoices
// (and read for listing). A restricted key scoped only to Checkout Sessions will
// get a StripePermissionError — handled and surfaced clearly by the API route.
import { getStripe } from './stripe';
import { HST_RATE } from './constants';
import { markUnitsSold } from './catalog-sync';

// items: [{ description, amount, sku? }] where amount is in DOLLARS (CAD).
// When a line came from the inventory picker it carries the unit's SKU; we stash
// the SKUs on the invoice's metadata so marking it paid can delist those units.
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo }) {
  const stripe = getStripe();

  // Reuse a customer by email, else create one.
  const existing = await stripe.customers.list({ email, limit: 1 });
  const customer = existing.data[0] || (await stripe.customers.create({ email, name: name || undefined }));

  const lineItems = (items || [])
    .map((it) => ({ description: String(it.description || '').trim().slice(0, 500), amountCents: Math.round(Number(it.amount) * 100) }))
    .filter((li) => li.description && li.amountCents > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

  // SKUs of inventory-picked lines, to delist on payment (deduped, comma-joined).
  const skus = [...new Set((items || []).map((it) => String(it?.sku || '').trim()).filter(Boolean))];

  if (addHst) {
    const subtotal = lineItems.reduce((a, li) => a + li.amountCents, 0);
    lineItems.push({ description: 'HST (13%)', amountCents: Math.round(subtotal * HST_RATE) });
  }

  // Draft invoice → attach items to it → finalize → email.
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    currency: 'cad',
    description: memo ? String(memo).slice(0, 500) : undefined,
    metadata: skus.length ? { skus: skus.join(',') } : undefined,
    auto_advance: false
  });
  for (const li of lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id, invoice: invoice.id, currency: 'cad',
      amount: li.amountCents, description: li.description
    });
  }
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(invoice.id);

  return {
    id: finalized.id,
    number: finalized.number,
    hostedUrl: finalized.hosted_invoice_url,
    pdf: finalized.invoice_pdf,
    total: (finalized.total || 0) / 100,
    status: finalized.status,
    email
  };
}

export async function listInvoices(limit = 25) {
  const stripe = getStripe();
  const res = await stripe.invoices.list({ limit });
  return res.data.map((inv) => ({
    id: inv.id,
    number: inv.number || '(draft)',
    email: inv.customer_email,
    total: (inv.total || 0) / 100,
    status: inv.status,
    method: (inv.metadata && inv.metadata.payment_method) || null,
    hostedUrl: inv.hosted_invoice_url,
    created: inv.created ? new Date(inv.created * 1000).toISOString() : null
  }));
}

// How a manual (off-Stripe) payment was taken.
export const PAYMENT_METHODS = {
  cash: 'Cash',
  etransfer: 'E-transfer',
  card: 'Card (manual)',
  cheque: 'Cheque',
  other: 'Other'
};

// Mark an open invoice paid when the money came in outside Stripe (cash,
// e-transfer, etc.) and record how. Records the method in metadata, then marks
// it paid "out of band" (no Stripe charge).
export async function markInvoicePaid(invoiceId, methodKey) {
  const stripe = getStripe();
  const label = PAYMENT_METHODS[methodKey] || 'Other';
  // Preserve any existing metadata (the SKUs stashed at creation) when adding the
  // payment method — a plain update would otherwise replace the whole map.
  const before = await stripe.invoices.retrieve(invoiceId);
  await stripe.invoices.update(invoiceId, { metadata: { ...(before.metadata || {}), payment_method: label } });
  const paid = await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });

  // Delist the units this invoice sold. Best-effort: never fail the payment over it.
  let soldSkus = 0;
  const skus = String(paid.metadata?.skus || before.metadata?.skus || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (skus.length) {
    try {
      const r = await markUnitsSold(skus, { channel: 'invoice', ref: paid.number || invoiceId, price: (paid.total || 0) / 100 });
      soldSkus = r.sold;
    } catch (e) {
      console.error('markUnitsSold (invoice) failed', e?.message || e);
    }
  }
  return { id: paid.id, number: paid.number, status: paid.status, method: label, soldSkus };
}
