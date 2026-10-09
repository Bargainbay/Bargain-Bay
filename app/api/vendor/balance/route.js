// The vendor's own money: balance, itemised statement and payout history, all from the ledger.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { vendorBalance, vendorStatement } from '../../../../lib/vendor-ledger';
import { vendorPayouts } from '../../../../lib/payouts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const ctx = await requireVendor();
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const [balance, statement, payouts] = await Promise.all([
    vendorBalance(ctx.vendor.id),
    vendorStatement(ctx.vendor.id, { from: sp.get('from'), to: sp.get('to') }),
    vendorPayouts(ctx.vendor.id)
  ]);
  return NextResponse.json({ balance, statement, payouts });
}
