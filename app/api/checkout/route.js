import { NextResponse } from 'next/server';
import { getMany } from '../../../lib/inventory';
import { hasDb, query, withTransaction } from '../../../lib/db';
import { unavailableSkus, reserveWithClient, expireReservations, RESERVATION_MINUTES, OFFLINE_HOLD_MINUTES } from '../../../lib/reservations';
import { stripeConfigured, createCheckoutSession } from '../../../lib/stripe';
import {
  getSession, hashPassword, createSessionToken,
  sessionCookieOptions, SESSION_COOKIE, normalizeEmail, validEmail
} from '../../../lib/auth';
import { round2, HST_RATE, DELIVERY_FEE, CARD_PAYMENTS_ENABLED } from '../../../lib/constants';
import { resolvePrices } from '../../../lib/pricing';
import { sendOrderEmails } from '../../../lib/email';
import { readAttribution, ensureAttributionColumns } from '../../../lib/attribution';
import { createAndSendInvoice } from '../../../lib/invoices';
import { validateCoupon, redeemCouponWithClient, releaseCouponForOrder, ensureCouponSchema } from '../../../lib/coupons';
import { upsertCustomer } from '../../../lib/customers';

export const dynamic = 'force-dynamic';

function siteUrl() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }

  const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).filter((s) => typeof s === 'string'))];
  const email = normalizeEmail(body.email);
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const deliveryMethod = body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim();
  const postal = String(body.postal || '').trim();
  const password = String(body.password || '');
  // Online card checkout is gated by the Stripe appeal (see CARD_PAYMENTS_ENABLED).
  // When off, the customer chooses how they'll pay offline: e-transfer or in person.
  const cardOnline = CARD_PAYMENTS_ENABLED && stripeConfigured();
  const paymentMethod = body.paymentMethod === 'in_person' ? 'in_person' : 'etransfer';
  const couponCode = String(body.couponCode || '').trim();

  // ---- validation ----
  if (!skus.length) return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
  if (!validEmail(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
  if (deliveryMethod === 'delivery' && (!address || !city || !postal)) {
    return NextResponse.json({ error: 'Delivery requires a street address, city, and postal code.' }, { status: 400 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: 'Online ordering is briefly offline — email sales@bargainbay.ca and we will hold the unit for you.' }, { status: 503 });
  }

  // Opportunistic housekeeping: clear expired holds / stale unpaid orders so
  // a unit abandoned mid-checkout is purchasable again without waiting for cron.
  expireReservations().catch((e) => console.error('opportunistic expiry failed', e.message));

  const items = await getMany(skus);
  if (items.length !== skus.length) {
    const found = new Set(items.map((u) => u.id));
    return NextResponse.json(
      { error: 'Some items are no longer in the catalogue.', unavailable: skus.filter((s) => !found.has(s)) },
      { status: 409 }
    );
  }

  // Fast pre-check (the transaction below is the authoritative race-safe gate).
  const blocked = await unavailableSkus(skus);
  if (blocked.size) {
    return NextResponse.json(
      { error: 'One or more items just sold or are held by another checkout.', unavailable: [...blocked] },
      { status: 409 }
    );
  }

  // ---- authoritative pricing (clearance + member tier; never trust the client) ----
  const session = await getSession();
  const priced = await resolvePrices(items, session);
  const priceOf = (u) => Number(priced.get(u.id)?.price ?? u.price);

  // ---- promo code (authoritative — the browser's figure is never used) ----
  // Re-checked here against the prices just resolved, so a code edited, expired
  // or exhausted between the Apply button and this request can't get through.
  // A code that no longer holds is dropped and the order proceeds at full price
  // rather than failing: losing the sale over a promo is the worse outcome, and
  // the response says which happened.
  let coupon = null;
  let discount = 0;
  let couponError = null;
  if (couponCode) {
    try {
      const goods = round2(items.reduce((a, u) => a + priceOf(u), 0));
      const eligible = round2(items.filter((u) => !priced.get(u.id)?.onClearance).reduce((a, u) => a + priceOf(u), 0));
      const check = await validateCoupon(couponCode, { subtotal: goods, eligibleSubtotal: eligible, email });
      if (check.ok) { coupon = check.coupon; discount = check.discount; }
      else couponError = check.error;
    } catch (e) {
      console.error('coupon check failed (continuing at full price)', e.message);
      couponError = 'We couldn’t apply that promo code.';
    }
  }

  // ---- totals (the discount comes off the goods; HST applies to what's left,
  //      plus delivery — a third-party cost we pass through undiscounted) ----
  const subtotal = round2(items.reduce((a, u) => a + priceOf(u), 0));
  const deliveryFee = deliveryMethod === 'delivery' ? DELIVERY_FEE : 0;
  const discounted = round2(Math.max(0, subtotal - discount));
  const hst = round2((discounted + deliveryFee) * HST_RATE);
  const total = round2(discounted + deliveryFee + hst);

  // ---- optional account creation ----
  let userId = session?.userId || null;
  let newSessionToken = null;
  if (!session && password) {
    if (password.length < 8) {
      return NextResponse.json({ error: 'Account password must be at least 8 characters (or leave it blank for guest checkout).' }, { status: 400 });
    }
    try {
      const hash = await hashPassword(password);
      const { rows } = await query(
        `INSERT INTO users (email, name, phone, password_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name`,
        [email, name, phone || null, hash]
      );
      if (rows.length) {
        userId = rows[0].id;
        newSessionToken = await createSessionToken(rows[0]);
      }
      // If the email already has an account, continue as guest — we can't
      // attach the order to an account that wasn't authenticated.
    } catch (e) {
      console.error('account creation during checkout failed (continuing as guest)', e);
    }
  }

  // ---- create order + items + reservations atomically ----
  // First-touch marketing attribution from the bb_attr cookie (best-effort).
  const attr = readAttribution(req);
  try { await ensureAttributionColumns(); } catch (e) { console.error('attribution columns', e.message); }
  // Unconditional: the INSERT below names coupon_code/discount whether or not a
  // code was entered, so a database that hasn't run the migration would fail
  // EVERY checkout, not just the ones with a promo.
  try { await ensureCouponSchema(); } catch (e) { console.error('coupon columns', e.message); }
  let order;
  try {
    order = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO orders (user_id, email, name, phone, delivery_method, address, city, postal,
                             status, subtotal, hst, total, payment_method, source, utm_campaign, referrer,
                             coupon_code, discount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_payment',$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [userId, email, name, phone || null, deliveryMethod,
         address || null, city || null, postal || null, subtotal, hst, total,
         cardOnline ? null : paymentMethod, attr.source, attr.campaign, attr.referrer,
         coupon ? coupon.code : null, discount]
      );
      const orderId = rows[0].id;
      const { rows: numbered } = await client.query(
        `UPDATE orders SET order_number = 'BB-' || (1000 + id) WHERE id = $1 RETURNING order_number`,
        [orderId]
      );
      // Card checkout holds the unit for 30 min (pay-now window); offline orders
      // hold it long-term until the owner confirms payment or cancels a no-show.
      await reserveWithClient(client, skus, orderId, cardOnline ? RESERVATION_MINUTES : OFFLINE_HOLD_MINUTES);
      for (const u of items) {
        await client.query(
          'INSERT INTO order_items (order_id, sku, title, price) VALUES ($1,$2,$3,$4)',
          [orderId, u.id, u.title || `${u.make} ${u.model}`, priceOf(u)]
        );
      }
      // Book the redemption in the same transaction as the order it belongs to —
      // a coupon must never be counted against an order that failed to be created.
      if (coupon) await redeemCouponWithClient(client, coupon, { orderId, email, subtotal, discount });
      return { id: orderId, orderNumber: numbered[0].order_number };
    });
  } catch (e) {
    if (e.code === 'SKU_HELD') {
      return NextResponse.json(
        { error: 'Someone else just started checking out with one of your items. It may free up in ~30 minutes.', unavailable: [e.sku] },
        { status: 409 }
      );
    }
    console.error('checkout transaction failed', e);
    return NextResponse.json({ error: 'Could not create your order. Please try again.' }, { status: 500 });
  }

  // Fold this buyer into the client database (guests included). Best-effort —
  // the CRM must never block a sale.
  upsertCustomer({ email, name, phone, address, city, postal, userId })
    .catch((e) => console.error('customer upsert failed', e.message));

  // Give the web sale an INV- number and a row in the invoice ledger, so every
  // sale carries the same paperwork whether it came from the storefront or from
  // a rep. It ATTACHES to the order just created rather than raising a new one,
  // and it is not emailed — the order confirmation below already carries the same
  // itemisation and e-transfer instructions, so a second email would just confuse
  // the customer. The order remains the source of truth; the invoice mirrors it.
  // Best-effort: paperwork must never cost us the sale.
  try {
    await createAndSendInvoice({
      name, email, phone,
      items: [
        ...items.map((u) => ({ description: u.title || `${u.make} ${u.model}`, amount: priceOf(u), sku: u.id })),
        ...(deliveryFee ? [{ description: 'Local delivery (Pickering & area)', amount: deliveryFee, kind: 'service' }] : []),
        // The discount rides as a negative service line, so the invoice totals
        // what the customer actually pays and the code is on the paperwork.
        ...(discount ? [{ description: `Promo code ${coupon.code}`, amount: -discount, kind: 'service' }] : [])
      ],
      addHst: hst > 0,
      deliveryMethod, address, city, postal,
      memo: `Online order ${order.orderNumber}.`,
      sendEmail: false,
      channel: 'web',
      attachToOrderId: order.id,
      createdBy: { email: 'website@bargainbay.ca', name: 'Website' }
    });
  } catch (e) {
    console.error('web order invoice creation failed', order.orderNumber, e.message);
  }

  const trackUrl = `/order/${order.orderNumber}` + (userId ? '' : `?email=${encodeURIComponent(email)}`);

  let payload;
  if (cardOnline) {
    // ---- hosted payment via Stripe Checkout ----
    try {
      const lineItems = [
        ...items.map((u) => ({
          name: `${u.make} ${u.model}`,
          priceCents: Math.round(priceOf(u) * 100)
        })),
        ...(deliveryFee ? [{ name: 'Local delivery (Pickering & area)', priceCents: Math.round(deliveryFee * 100) }] : []),
        ...(discount ? [{ name: `Promo code ${coupon.code}`, priceCents: -Math.round(discount * 100) }] : []),
        { name: 'HST 13% (Ontario)', priceCents: Math.round(hst * 100) }
      ];
      const { url, sessionId } = await createCheckoutSession({
        lineItems,
        email,
        orderId: order.id,
        orderNumber: order.orderNumber,
        successUrl: `${siteUrl()}${trackUrl}${trackUrl.includes('?') ? '&' : '?'}status=success`,
        cancelUrl: `${siteUrl()}/checkout?status=failed`
      });
      if (sessionId) {
        await query('UPDATE orders SET stripe_session_id = $2 WHERE id = $1', [order.id, sessionId]).catch(() => {});
      }
      payload = { url, orderNumber: order.orderNumber, discount, couponCode: coupon ? coupon.code : null, couponError };
    } catch (e) {
      console.error('Stripe session failed — cancelling order', e);
      await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]).catch(() => {});
      await query('DELETE FROM reservations WHERE order_id = $1', [order.id]).catch(() => {});
      // The order never happened, so the promo code shouldn't have been spent.
      if (coupon) await releaseCouponForOrder(order.id);
      return NextResponse.json({ error: 'Payment provider is unavailable right now. Please try again in a few minutes.' }, { status: 502 });
    }
  } else {
    // ---- offline payment: order placed, awaiting e-transfer or pay-on-pickup ----
    // Stays 'pending_payment' (its label "Pending payment" fits) until the owner
    // marks it Confirmed once the money lands. The long reservation holds the unit.
    // Customer receipt + owner alert (fire-and-forget; never blocks the order).
    sendOrderEmails(
      { orderNumber: order.orderNumber, name, email, deliveryMethod, address, city, postal,
        subtotal, hst, total, paymentMethod, discount, couponCode: coupon ? coupon.code : null },
      items.map((u) => ({ title: u.title || `${u.make} ${u.model}`, price: priceOf(u) }))
    ).catch((e) => console.error('order emails failed', e.message));
    payload = { orderUrl: trackUrl, orderNumber: order.orderNumber, discount, couponCode: coupon ? coupon.code : null, couponError };
  }

  const res = NextResponse.json(payload);
  if (newSessionToken) res.cookies.set(SESSION_COOKIE, newSessionToken, sessionCookieOptions());
  return res;
}
