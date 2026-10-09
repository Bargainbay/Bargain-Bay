// A vendor's banking details. Read: masked (last four digits only), by anyone who acts for the
// vendor. Write: the account OWNER only. The full number is never returned by anything here.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { bankSummary, submitBankAccount } from '../../../../lib/vendor-bank';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  return NextResponse.json(await bankSummary(ctx.vendor.id));
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    const r = await submitBankAccount({ vendorId: ctx.vendor.id, role: ctx.vendor.role, by: ctx.session.email }, body || {});
    return NextResponse.json({ ok: true, last4: r.last4 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save those details.' }, { status: 400 });
  }
}
