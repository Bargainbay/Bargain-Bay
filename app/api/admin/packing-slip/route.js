import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { getPackingSlip } from '../../../../lib/invoices';
import { sendPackingSlipEmail } from '../../../../lib/email';
import { DISPATCH_EMAIL } from '../../../../lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// Email a packing slip to the warehouse/delivery team. Body: { number, to? }.
// `to` defaults to dispatch@bargainbay.ca.
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const number = String(body.number || '').trim();
  const to = String(body.to || '').trim() || DISPATCH_EMAIL;
  if (!number) return NextResponse.json({ error: 'Invoice number is required.' }, { status: 400 });
  try {
    const slip = await getPackingSlip(number);
    if (!slip) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    const r = await sendPackingSlipEmail(slip, { to });
    if (!r?.ok) return NextResponse.json({ error: r?.error || r?.reason || 'Email could not be sent (is email configured?).' }, { status: 502 });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    console.error('packing-slip email failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not send the packing slip.' }, { status: 500 });
  }
}
