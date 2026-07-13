// Post-payment order editing. One admin-gated endpoint, three actions:
//   contact — fix name/email/phone/fulfilment/address (any order, no money)
//   items   — replace line items (inventory + totals kept consistent)
//   refund  — full or per-unit order-level refund (storefront orders)
// Invoice-bridged orders refuse items/refund with a pointer to the invoice.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { updateOrderContact, updateOrderItems, refundOrder } from '../../../../lib/orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const order = body.order ?? body.orderId;
  if (!order) return NextResponse.json({ error: 'Missing order' }, { status: 400 });

  try {
    if (body.action === 'contact') {
      const updated = await updateOrderContact(order, body);
      return NextResponse.json({ ok: true, order: { number: updated.order_number } });
    }
    if (body.action === 'items') {
      const result = await updateOrderItems(order, body.items);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === 'refund') {
      const result = await refundOrder(order, { skus: body.skus });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Update failed.' }, { status: 400 });
  }
}
