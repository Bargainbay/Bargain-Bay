import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { stripeConfigured } from '../../../../lib/stripe';
import { createAndSendInvoice, listInvoices, markInvoicePaid, PAYMENT_METHODS } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// Map Stripe's permission error to a clear, actionable message for the owner.
function explain(e) {
  const msg = e?.raw?.message || e?.message || 'Something went wrong creating the invoice.';
  if (e?.type === 'StripePermissionError' || /permission|scope|restricted key/i.test(msg)) {
    return 'Your Stripe API key needs write access to Customers, Invoice Items, and Invoices (and read for listing). Update the restricted key in Stripe → Developers → API keys, then redeploy.';
  }
  return msg;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!stripeConfigured()) return NextResponse.json({ invoices: [], stripe: false });
  try {
    return NextResponse.json({ invoices: await listInvoices(25), stripe: true });
  } catch (e) {
    return NextResponse.json({ invoices: [], stripe: true, error: explain(e) }, { status: 200 });
  }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not configured (set STRIPE_SECRET_KEY).' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const addHst = !!body.addHst;
  const daysUntilDue = Math.min(Math.max(parseInt(body.daysUntilDue, 10) || 14, 1), 90);
  const memo = String(body.memo || '').trim();

  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
  if (!items.some((it) => String(it?.description || '').trim() && Number(it?.amount) > 0)) {
    return NextResponse.json({ error: 'Add at least one line item with a description and a positive amount.' }, { status: 400 });
  }

  try {
    const invoice = await createAndSendInvoice({ name, email, items, addHst, daysUntilDue, memo });
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error('create invoice failed', e?.message || e);
    return NextResponse.json({ error: explain(e) }, { status: 502 });
  }
}

// Mark an open invoice paid out-of-band (cash / e-transfer / etc.) + record how.
export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!stripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const invoiceId = String(body.invoiceId || '').trim();
  const method = String(body.method || '').trim();
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });
  if (!PAYMENT_METHODS[method]) return NextResponse.json({ error: 'Pick a valid payment method.' }, { status: 400 });
  try {
    const invoice = await markInvoicePaid(invoiceId, method);
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error('mark invoice paid failed', e?.message || e);
    return NextResponse.json({ error: explain(e) }, { status: 502 });
  }
}
