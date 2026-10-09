// Money that comes off a seller after a sale (a customer refund we paid, a guarantee claim, a charge-back,
// an adjustment). The business's books, so ADMIN only on every method. Each submission carries a key made
// by the form, so pressing the button twice, or a retried request, records it once.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { deduct, adjust, vendorStatement } from '../../../../../lib/vendor-ledger';
import { DEDUCTION_REASONS } from '../../../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return denied();
  const vendorId = Number(new URL(req.url).searchParams.get('vendorId'));
  if (!vendorId) return NextResponse.json({ error: 'Which vendor?' }, { status: 400 });
  return NextResponse.json({ statement: await vendorStatement(vendorId, { limit: 200 }), reasons: DEDUCTION_REASONS });
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const vendorId = Number(b?.vendorId);
  const key = String(b?.key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!vendorId) return NextResponse.json({ error: 'Which vendor?' }, { status: 400 });
  if (!key) return NextResponse.json({ error: 'Missing form key — reload the page.' }, { status: 400 });
  const reason = DEDUCTION_REASONS[b?.reason];
  if (!reason) return NextResponse.json({ error: 'Choose a reason from the list.' }, { status: 400 });
  const cents = Math.round(Number(b.dollars) * 100);
  const memo = String(b.memo || '').trim();
  try {
    if (reason.kind === 'adjustment') {
      // either direction: "direction" says whether it adds to or comes off what we owe them
      const signed = b.direction === 'add' ? cents : -cents;
      return NextResponse.json(await adjust(vendorId, { amountCents: signed, memo, by: s.email, idemKey: `adj:${vendorId}:${key}` }));
    }
    return NextResponse.json(await deduct(vendorId, {
      kind: reason.kind, amountCents: cents, orderRef: String(b.orderRef || '').trim() || null, memo: memo || reason.label, by: s.email,
      idemKey: `ded:${vendorId}:${key}`, drawReserve: reason.kind === 'guarantee_claim' && b.drawReserve !== false, bookedElsewhere: reason.kind === 'refund' && !!b.bookedElsewhere
    }));
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
