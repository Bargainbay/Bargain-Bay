// Vendor orders from the staff side. Staff can see every order and mark a Lane C order delivered once
// the carrier confirms (the customer's sale). The delivery-service fees are the business's pricing: admin.
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../../lib/auth';
import { allVendorOrders, deliverVendorOrder, deliveryRates, setDeliveryRate } from '../../../../../lib/vendor-orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  const out = { orders: await allVendorOrders({ status: new URL(req.url).searchParams.get('status') || undefined }), now: new Date().toISOString() };
  if (isAdmin(s)) out.rates = await deliveryRates();
  return NextResponse.json(out);
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  try {
    if (b?.action === 'deliver') return NextResponse.json(await deliverVendorOrder(Number(b.id), { by: s.email }));
    if (b?.action === 'set_rate') {
      if (!isAdmin(s)) return denied();
      return NextResponse.json(await setDeliveryRate(b.sizeClass, Math.round(Number(b.dollars) * 100), { by: s.email }));
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
