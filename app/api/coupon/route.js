import { NextResponse } from 'next/server';
import { getMany } from '../../../lib/inventory';
import { resolvePrices } from '../../../lib/pricing';
import { getSession, normalizeEmail } from '../../../lib/auth';
import { validateCoupon } from '../../../lib/coupons';
import { round2 } from '../../../lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// "What is this promo code worth on my cart?" — the shopper-facing check behind
// the Apply button at checkout.
//
// It prices the cart itself rather than believing a subtotal from the browser,
// so the figure shown here is the same one `/api/checkout` will apply. This
// endpoint reserves nothing and redeems nothing; the coupon is only ever booked
// against a real order, inside the checkout transaction.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const code = String(body.code || '').trim();
  if (!code) return NextResponse.json({ ok: false, error: 'Enter a promo code.' }, { status: 400 });

  const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).filter((s) => typeof s === 'string'))].slice(0, 50);
  if (!skus.length) return NextResponse.json({ ok: false, error: 'Your cart is empty.' }, { status: 400 });

  const items = await getMany(skus);
  if (!items.length) return NextResponse.json({ ok: false, error: 'Your cart is empty.' }, { status: 400 });

  const session = await getSession();
  const priced = await resolvePrices(items, session);
  const priceOf = (u) => Number(priced.get(u.id)?.price ?? u.price);
  const subtotal = round2(items.reduce((a, u) => a + priceOf(u), 0));
  const eligible = round2(items.filter((u) => !priced.get(u.id)?.onClearance).reduce((a, u) => a + priceOf(u), 0));

  const email = normalizeEmail(body.email || session?.email || '');
  const res = await validateCoupon(code, { subtotal, eligibleSubtotal: eligible, email }).catch(() => null);
  if (!res) return NextResponse.json({ ok: false, error: 'Promo codes are briefly unavailable — your order is unaffected.' }, { status: 200 });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 200 });

  return NextResponse.json({
    ok: true,
    code: res.coupon.code,
    discount: res.discount,
    // Enough for the summary line, and nothing about who the code belongs to.
    label: res.coupon.kind === 'percent' ? `${res.coupon.value}% off` : `$${res.coupon.value.toFixed(2)} off`,
    excludesClearance: res.coupon.excludeClearance
  });
}
