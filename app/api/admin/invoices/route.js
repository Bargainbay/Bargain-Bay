import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { createAndSendInvoice, listInvoices, markInvoicePaid, voidInvoice, PAYMENT_METHODS } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

function noDb() {
  return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ invoices: [] });
  try {
    return NextResponse.json({ invoices: await listInvoices(25) });
  } catch (e) {
    return NextResponse.json({ invoices: [], error: e?.message || 'Could not load invoices.' }, { status: 200 });
  }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
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
    return NextResponse.json({ error: e?.message || 'Something went wrong creating the invoice.' }, { status: 500 });
  }
}

// Mark an open invoice paid (cash / e-transfer / etc.) or void it.
export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const invoiceId = Number(body.invoiceId);
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });

  try {
    if (body.action === 'void') {
      const voided = await voidInvoice(invoiceId);
      if (!voided) return NextResponse.json({ error: 'Only an open invoice can be voided.' }, { status: 409 });
      return NextResponse.json({ ok: true, invoice: { id: voided.id, number: voided.number, status: 'void' } });
    }
    const method = String(body.method || '').trim();
    if (!PAYMENT_METHODS[method]) return NextResponse.json({ error: 'Pick a valid payment method.' }, { status: 400 });
    const invoice = await markInvoicePaid(invoiceId, method);
    return NextResponse.json({ ok: true, invoice });
  } catch (e) {
    console.error('update invoice failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not update the invoice.' }, { status: 500 });
  }
}
