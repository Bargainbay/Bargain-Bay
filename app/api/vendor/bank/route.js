// A vendor's banking details. Read: masked (last four digits only), by anyone who acts for the
// vendor. Write: the account OWNER only, with a fresh two-factor check. The full number is never returned by anything here.
import { NextResponse } from 'next/server';
import { requireVendor, checkVendor, denial } from '../../../../lib/vendor-session';
import { bankSummary, submitBankAccount } from '../../../../lib/vendor-bank';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const ctx = await requireVendor('bank.view');
  if (!ctx) return denied();
  return NextResponse.json(await bankSummary(ctx.vendor.id));
}

export async function POST(req) {
  // Changing where the money goes: the owner, with a second factor enrolled AND checked in the
  // last few minutes (lib/vendor-session.js `stepUp`). `denial` tells the page which to ask for.
  const r = await checkVendor('bank.edit', { stepUp: true });
  if (!r.ok) { const d = denial(r); return NextResponse.json(d.body, { status: d.status }); }
  const ctx = r.ctx;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    const r = await submitBankAccount({ vendorId: ctx.vendor.id, role: ctx.vendor.role, by: ctx.session.email }, body || {});
    return NextResponse.json({ ok: true, last4: r.last4 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save those details.' }, { status: 400 });
  }
}
