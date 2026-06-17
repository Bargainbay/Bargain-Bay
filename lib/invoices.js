// Manual invoicing via Stripe Invoicing. Creates a hosted, payable invoice and
// emails it to the customer. Reuses the same Stripe account as checkout.
//
// NOTE: the API key needs write access to Customers, Invoice Items, and Invoices
// (and read for listing). A restricted key scoped only to Checkout Sessions will
// get a StripePermissionError — handled and surfaced clearly by the API route.
import { getStripe } from './stripe';
import { HST_RATE } from './constants';

// items: [{ description, amount }] where amount is in DOLLARS (CAD).
export async function createAndSendInvoice({ name, email, items, addHst, daysUntilDue = 14, memo }) {
  const stripe = getStripe();

  // Reuse a customer by email, else create one.
  const existing = await stripe.customers.list({ email, limit: 1 });
  const customer = existing.data[0] || (await stripe.customers.create({ email, name: name || undefined }));

  const lineItems = (items || [])
    .map((it) => ({ description: String(it.description || '').trim().slice(0, 500), amountCents: Math.round(Number(it.amount) * 100) }))
    .filter((li) => li.description && li.amountCents > 0);
  if (!lineItems.length) throw new Error('Add at least one line item with a description and a positive amount.');

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
    hostedUrl: inv.hosted_invoice_url,
    created: inv.created ? new Date(inv.created * 1000).toISOString() : null
  }));
}
