import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { createAndSendQuote, updateQuote, listQuotes, convertQuoteToInvoice, voidQuote } from '../../../../lib/quotes';

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
  if (!hasDb()) return NextResponse.json({ quotes: [] });
  try {
    return NextResponse.json({ quotes: await listQuotes(25) });
  } catch (e) {
    return NextResponse.json({ quotes: [], error: e?.message || 'Could not load quotes.' }, { status: 200 });
  }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.some((it) => String(it?.description || '').trim() && Number(it?.amount) > 0)) {
    return NextResponse.json({ error: 'Add at least one line item with a name and price.' }, { status: 400 });
  }

  try {
    const quote = await createAndSendQuote({
      name: body.name,
      email,
      items,
      bundlePct: body.bundlePct,
      cashDeal: body.cashDeal,
      freeDelivery: !!body.freeDelivery,
      addHst: body.addHst !== false,
      daysValid: body.daysValid,
      memo: body.memo,
      sourceQuoteId: body.sourceQuoteId ? Number(body.sourceQuoteId) : null
    });
    return NextResponse.json({ ok: true, quote });
  } catch (e) {
    console.error('create quote failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not create the quote.' }, { status: 500 });
  }
}

export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const quoteId = Number(body.quoteId);
  if (!quoteId) return NextResponse.json({ error: 'quoteId is required.' }, { status: 400 });

  try {
    if (body.action === 'void') {
      const voided = await voidQuote(quoteId);
      if (!voided) return NextResponse.json({ error: 'Only an open quote can be voided.' }, { status: 409 });
      return NextResponse.json({ ok: true, quote: { id: voided.id, number: voided.number, status: 'void' } });
    }
    if (body.action === 'convert') {
      const result = await convertQuoteToInvoice(quoteId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === 'update') {
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
      const quote = await updateQuote(quoteId, {
        name: body.name,
        email,
        items: Array.isArray(body.items) ? body.items : [],
        bundlePct: body.bundlePct,
        cashDeal: body.cashDeal,
        freeDelivery: !!body.freeDelivery,
        addHst: body.addHst !== false,
        daysValid: body.daysValid,
        memo: body.memo
      });
      return NextResponse.json({ ok: true, quote });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    console.error('update quote failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not update the quote.' }, { status: 500 });
  }
}
