// "It isn't on the tracker" — booking an appliance in from an invoice line whose
// stock search found nothing. Staff-level (it is part of raising an invoice), and
// guarded in bookInForInvoice: refused whenever the tracker or RS Ops already
// holds that model or serial, with those units handed back to pick instead.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import { bookInForInvoice } from '../../../../../lib/stock-reconcile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // a tracker read, an RS Ops call and an append

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    const r = await bookInForInvoice({
      make: b.make, model: b.model, category: b.category, serial: b.serial,
      description: b.description, rsopsSku: b.rsopsSku ? String(b.rsopsSku) : null,
      by: s.name || s.email
    });
    // A duplicate is an answer, not a failure: 409 with the units to pick.
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not book it in.' }, { status: e?.status || 500 });
  }
}
