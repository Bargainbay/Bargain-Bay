import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { createAndSendInvoice, listInvoices, listInvoiceAuthors, markInvoicePaid, voidInvoice, refundInvoice, refundInvoiceItems, refundInvoiceAmount, deleteInvoice,
         updateInvoice, resendInvoice, backfillInvoiceOrder, backfillAllInvoiceOrders, recordInvoicePayment, voidInvoicePayment, PAYMENT_METHODS } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// Selling surfaces (create/send/edit/mark-paid/void/refund invoices + quotes)
// are open to sales associates as well as admins.
async function staff() {
  const s = await getSession();
  return !!(s && isStaff(s));
}

function noDb() {
  return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
}

// ?q= search (number, BB order number, customer, memo, line description, SKU),
// ?status= filter, ?limit= / ?offset= paging. No params = the recent invoices.
export async function GET(req) {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ invoices: [], total: 0, owing: 0, hasMore: false });
  const sp = new URL(req.url).searchParams;
  try {
    const res = await listInvoices({
      q: (sp.get('q') || '').slice(0, 100),
      status: sp.get('status') || '',
      rep: (sp.get('rep') || '').slice(0, 200),
      limit: sp.get('limit') || 25,
      offset: sp.get('offset') || 0
    });
    return NextResponse.json({ ...res, authors: await listInvoiceAuthors().catch(() => []) });
  } catch (e) {
    return NextResponse.json({ invoices: [], total: 0, owing: 0, hasMore: false, error: e?.message || 'Could not load invoices.' }, { status: 200 });
  }
}

export async function POST(req) {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const addHst = !!body.addHst;
  // The rep typed prices with the tax already in them. The split happens in the
  // lib, from these same amounts — the browser's preview is never taken as read.
  const taxInclusive = !!body.taxInclusive;
  const daysUntilDue = Math.min(Math.max(parseInt(body.daysUntilDue, 10) || 14, 1), 90);
  const memo = String(body.memo || '').trim();
  const deliveryMethod = body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim();
  const postal = String(body.postal || '').trim();
  const phone = String(body.phone || '').trim();
  const sendEmail = body.sendEmail !== false; // default true; only false explicitly skips the email
  const invoiceDate = String(body.invoiceDate || '').trim(); // optional 'YYYY-MM-DD' backdate (validated in lib)

  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
  if (!items.some((it) => String(it?.description || '').trim() && Number(it?.amount) > 0)) {
    return NextResponse.json({ error: 'Add at least one line item with a description and a positive amount.' }, { status: 400 });
  }
  if (deliveryMethod === 'delivery' && (!address || !city || !postal)) {
    return NextResponse.json({ error: 'Delivery requires a street address, city, and postal code.' }, { status: 400 });
  }

  // Stamp the invoice with whoever is signed in. Taken from the session, never
  // from the request body — otherwise one rep could raise an invoice in another's
  // name, and the whole point is knowing who actually did it.
  const session = await getSession();
  try {
    const invoice = await createAndSendInvoice({
      name, email, items, addHst, taxInclusive, daysUntilDue, memo, deliveryMethod, address, city, postal, phone, sendEmail, invoiceDate,
      createdBy: { email: session?.email, name: session?.name }
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error('create invoice failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Something went wrong creating the invoice.' }, { status: 500 });
  }
}

// Mark an open invoice paid (cash / e-transfer / etc.) or void it.
export async function PATCH(req) {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }

  // Bulk repair — no specific invoice. Backfills orders for every paid invoice
  // missing one (fixes paid invoices invisible to the dashboard).
  if (body.action === 'backfill_all') {
    try {
      // The Sync button is the owner explicitly asking for the full sweep.
      const r = await backfillAllInvoiceOrders({ all: true });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Backfill failed.' }, { status: 500 });
    }
  }

  const invoiceId = Number(body.invoiceId);
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });

  try {
    if (body.action === 'edit') {
      // Customer / fulfilment fields are optional on an edit: only keys actually
      // present are forwarded, so an editor that submits just the line items
      // can't blank someone's address.
      const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
      if (has('email')) {
        const e = normalizeEmail(body.email);
        if (!validEmail(e)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
      }
      if (has('deliveryMethod') && body.deliveryMethod === 'delivery') {
        const need = ['address', 'city', 'postal'].filter((k) => !String(body[k] || '').trim());
        if (need.length) {
          return NextResponse.json({ error: 'Delivery requires a street address, city, and postal code.' }, { status: 400 });
        }
      }
      const updated = await updateInvoice(invoiceId, {
        items: Array.isArray(body.items) ? body.items : [],
        addHst: !!body.addHst,
        taxInclusive: !!body.taxInclusive,
        memo: body.memo,
        invoiceDate: String(body.invoiceDate || '').trim(),
        ...(has('name') ? { name: body.name } : {}),
        ...(has('email') ? { email: normalizeEmail(body.email) } : {}),
        ...(has('phone') ? { phone: body.phone } : {}),
        ...(has('deliveryMethod') ? { deliveryMethod: body.deliveryMethod } : {}),
        ...(has('address') ? { address: body.address } : {}),
        ...(has('city') ? { city: body.city } : {}),
        ...(has('postal') ? { postal: body.postal } : {})
      });
      // Optionally re-email the customer the updated invoice. The save already
      // succeeded, so a mail failure is reported as a warning, not an error.
      let emailed = false, emailError = null;
      if (body.resend) {
        try { await resendInvoice(invoiceId); emailed = true; }
        catch (e) { emailError = e?.message || 'The invoice saved, but the email failed to send.'; }
      }
      return NextResponse.json({ ok: true, invoice: updated, emailed, emailError });
    }
    // Re-send the invoice email as-is (customer lost it / wrong inbox found).
    if (body.action === 'resend') {
      const r = await resendInvoice(invoiceId);
      return NextResponse.json({ ok: true, invoice: r });
    }
    if (body.action === 'backfill') {
      const r = await backfillInvoiceOrder(invoiceId);
      return NextResponse.json({ ok: true, invoice: r });
    }
    // Partial payment (deposit / instalment). Auto-completes to fully paid when
    // the recorded payments reach the invoice total.
    if (body.action === 'record_payment') {
      const r = await recordInvoicePayment(invoiceId, {
        amount: body.amount, method: String(body.method || '').trim(),
        paidDate: String(body.paidDate || '').trim(), note: body.note
      });
      return NextResponse.json({ ok: true, invoice: r });
    }
    // Remove a payment recorded in error (only while the invoice isn't settled).
    if (body.action === 'void_payment') {
      const r = await voidInvoicePayment(invoiceId, body.paymentId);
      return NextResponse.json({ ok: true, invoice: r });
    }
    if (body.action === 'void') {
      const voided = await voidInvoice(invoiceId);
      if (!voided) return NextResponse.json({ error: 'Only an open invoice can be voided.' }, { status: 409 });
      return NextResponse.json({ ok: true, invoice: { id: voided.id, number: voided.number, status: 'void' } });
    }
    // Whoever is signed in owns the refund, same rule as invoice creation: taken
    // from the session, never from the body.
    const actor = (await getSession())?.email || null;
    if (body.action === 'refund') {
      const refunded = await refundInvoice(invoiceId, {
        restockingPct: body.restockingPct, reason: body.reason, by: actor
      });
      return NextResponse.json({ ok: true, invoice: refunded });
    }
    // Per-unit refund: refund only the selected line items (invoice_items.id).
    // `restockingPct` keeps that share of their value as a fee.
    if (body.action === 'refund_items') {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
      const refunded = await refundInvoiceItems(invoiceId, {
        itemIds, restockingPct: body.restockingPct, reason: body.reason, by: actor
      });
      return NextResponse.json({ ok: true, invoice: refunded });
    }
    // Money-only refund of an arbitrary amount (price adjustment / goodwill /
    // deposit handed back). Moves no stock — the per-line refund does that.
    if (body.action === 'refund_amount') {
      const refunded = await refundInvoiceAmount(invoiceId, {
        amount: body.amount, reason: body.reason, by: actor
      });
      return NextResponse.json({ ok: true, invoice: refunded });
    }
    const method = String(body.method || '').trim();
    if (!PAYMENT_METHODS[method]) return NextResponse.json({ error: 'Pick a valid payment method.' }, { status: 400 });
    const invoice = await markInvoicePaid(invoiceId, method, String(body.paidDate || '').trim());
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error('update invoice failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not update the invoice.' }, { status: 500 });
  }
}

// Permanently delete an invoice created in error (open/void only — paid ones
// must be refunded). Body: { invoiceId }.
export async function DELETE(req) {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const invoiceId = Number(body.invoiceId);
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });
  try {
    const res = await deleteInvoice(invoiceId);
    return NextResponse.json({ ok: true, invoice: res });
  } catch (e) {
    console.error('delete invoice failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not delete the invoice.' }, { status: 400 });
  }
}
