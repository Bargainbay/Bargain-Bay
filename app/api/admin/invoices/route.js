import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { createAndSendInvoice, listInvoices, markInvoicePaid, voidInvoice, refundInvoice, refundInvoiceItems, deleteInvoice,
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

export async function GET() {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ invoices: [] });
  try {
    return NextResponse.json({ invoices: await listInvoices(25) });
  } catch (e) {
    return NextResponse.json({ invoices: [], error: e?.message || 'Could not load invoices.' }, { status: 200 });
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

  try {
    const invoice = await createAndSendInvoice({ name, email, items, addHst, daysUntilDue, memo, deliveryMethod, address, city, postal, phone, sendEmail, invoiceDate });
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
      const r = await backfillAllInvoiceOrders();
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Backfill failed.' }, { status: 500 });
    }
  }

  const invoiceId = Number(body.invoiceId);
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });

  try {
    if (body.action === 'edit') {
      const updated = await updateInvoice(invoiceId, {
        items: Array.isArray(body.items) ? body.items : [],
        addHst: !!body.addHst,
        memo: body.memo,
        invoiceDate: String(body.invoiceDate || '').trim()
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
    if (body.action === 'refund') {
      const refunded = await refundInvoice(invoiceId);
      return NextResponse.json({ ok: true, invoice: refunded });
    }
    // Per-unit refund: refund only the selected line items (invoice_items.id).
    if (body.action === 'refund_items') {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
      const refunded = await refundInvoiceItems(invoiceId, { itemIds });
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
