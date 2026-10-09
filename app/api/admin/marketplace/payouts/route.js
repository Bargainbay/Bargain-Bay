// Paying vendors. ADMIN only — this is the business's books, not a customer's sale.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../../lib/auth';
import {
  proposePayouts, proposeForVendor, approvePayout, cancelPayout, markPayoutPaid, markPayoutFailed,
  clearFirstPayout, payoutFile, listPayouts
} from '../../../../../lib/payouts';
import { vendorBalance, adjust } from '../../../../../lib/vendor-ledger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  if (!(await admin())) return denied();
  const sp = new URL(req.url).searchParams;
  const vendorId = Number(sp.get('vendorId'));
  if (vendorId) return NextResponse.json({ balance: await vendorBalance(vendorId) });
  return NextResponse.json({ payouts: await listPayouts({ status: sp.get('status') || undefined }) });
}

export async function POST(req) {
  const s = await admin();
  if (!s) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = s.email;
  const id = Number(b?.id);
  try {
    switch (b?.action) {
      case 'propose_all': return NextResponse.json(await proposePayouts({ by }));
      case 'propose': return NextResponse.json(await proposeForVendor(Number(b.vendorId), { by, amountCents: b.amountCents }));
      case 'approve': return NextResponse.json(await approvePayout(id, { by }));
      case 'cancel': return NextResponse.json(await cancelPayout(id, { by, note: b.note }));
      case 'paid': return NextResponse.json(await markPayoutPaid(id, { by, ref: b.ref }));
      case 'failed': return NextResponse.json(await markPayoutFailed(id, { by, note: b.note }));
      case 'clear_first': return NextResponse.json(await clearFirstPayout(Number(b.vendorId), { by }));
      case 'adjust': return NextResponse.json(await adjust(Number(b.vendorId), { amountCents: b.amountCents, memo: b.memo, by }));
      case 'file': {
        const { csv, count } = await payoutFile((b.ids || []).map(Number).filter(Boolean), { by });
        return new Response(csv, { headers: {
          'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="vendor-payouts-${new Date().toISOString().slice(0, 10)}-${count}.csv"`
        } });
      }
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
