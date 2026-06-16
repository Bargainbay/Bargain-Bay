// Stripe Checkout client. Creates a hosted Checkout Session and returns
// { url, sessionId } to redirect the customer to. Lazy — nothing touches the
// secret key at module load, so `next build` succeeds without Stripe configured.
import Stripe from 'stripe';

let _stripe = null;

export function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// lineItems: [{ name, priceCents }] — all amounts in CAD cents. HST and delivery
// are passed as their own line items so the Stripe total matches the order total
// exactly (we never let Stripe compute tax — the server already did).
export async function createCheckoutSession({ lineItems, email, orderId, orderNumber, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email || undefined,
    line_items: lineItems.map((li) => ({
      quantity: 1,
      price_data: {
        currency: 'cad',
        unit_amount: li.priceCents,
        product_data: { name: li.name }
      }
    })),
    // metadata lets the webhook match the Stripe session back to our order even
    // if the stored session id lookup misses.
    metadata: { orderId: String(orderId), orderNumber },
    payment_intent_data: { description: `Bargain Bay order ${orderNumber}` },
    success_url: successUrl,
    cancel_url: cancelUrl
  });
  return { url: session.url, sessionId: session.id };
}
