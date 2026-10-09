// A vendor's orders: list them, and accept / mark ready / cancel. The vendor id comes from the
// session; another vendor's order id is exactly "Order not found". Times are judged on the server.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { listVendorOrders, acceptVendorOrder, markVendorOrderReady, cancelVendorOrder } from '../../../../lib/vendor-orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const status = new URL(req.url).searchParams.get('status') || undefined;
  return NextResponse.json({ orders: await listVendorOrders(ctx.vendor.id, { status }), now: new Date().toISOString() });
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const by = ctx.session.email;
  try {
    switch (b.action) {
      case 'accept': return NextResponse.json(await acceptVendorOrder(ctx.vendor.id, id, { insurance: b.insurance, by }));
      case 'ready': return NextResponse.json(await markVendorOrderReady(ctx.vendor.id, id, { carrier: b.carrier, trackingNumber: b.trackingNumber, by }));
      case 'cancel': return NextResponse.json(await cancelVendorOrder(ctx.vendor.id, id, { reasonCode: b.reasonCode, note: b.note, by }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
