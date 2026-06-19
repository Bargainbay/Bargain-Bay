import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listSalvage, syncSalvage, markSalvageDisposed } from '../../../../lib/salvage';
import { createAndSendInvoice } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ available: [], disposed: [], stats: {} });
  try {
    return NextResponse.json(await listSalvage());
  } catch (e) {
    return NextResponse.json({ available: [], disposed: [], stats: {}, error: e?.message || 'Load failed' }, { status: 200 });
  }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }

  // Pull/refresh the salvage list from the tracker.
  if (body.action === 'sync') {
    try {
      const r = await syncSalvage();
      return NextResponse.json({ ok: true, ...r, ...(await listSalvage()) });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 500 });
    }
  }

  // Invoice selected salvage units (bulk or single) and mark them disposed.
  if (body.action === 'invoice') {
    const email = normalizeEmail(body.email);
    const name = String(body.name || '').trim();
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((it) => ({ sku: String(it.sku || '').trim(), description: String(it.description || '').trim().slice(0, 500), amount: Number(it.amount) }))
      .filter((it) => it.sku && it.description && it.amount > 0);
    if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid buyer email.' }, { status: 400 });
    if (!items.length) return NextResponse.json({ error: 'Select at least one unit and enter a price.' }, { status: 400 });
    try {
      const invoice = await createAndSendInvoice({
        name, email, items, addHst: !!body.addHst, daysUntilDue: body.daysUntilDue, memo: String(body.memo || 'Salvage / parts-only sale').slice(0, 500)
      });
      const prices = {};
      items.forEach((it) => { prices[it.sku] = it.amount; });
      await markSalvageDisposed(items.map((it) => it.sku), { invoiceNumber: invoice.number, prices });
      return NextResponse.json({ ok: true, invoice, ...(await listSalvage()) });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not create the salvage invoice.' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
