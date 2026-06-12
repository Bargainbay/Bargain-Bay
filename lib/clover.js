// Clover Hosted Checkout client.
// Creates a checkout session and returns { url, sessionId } to redirect to.
// Docs: https://docs.clover.com/dev/docs/hosted-checkout-api
// NOTE: confirm the exact request schema/fields against your Clover dashboard;
// field names occasionally differ by region/processor.

const HOST =
  process.env.CLOVER_ENV === 'production'
    ? 'https://scl.clover.com'
    : 'https://scl-sandbox.dev.clover.com';

export function cloverConfigured() {
  return !!process.env.CLOVER_PRIVATE_TOKEN;
}

// lineItems: [{ name, priceCents, note }] — pass HST and delivery as explicit
// line items so the hosted page total matches the order total exactly.
export async function createHostedCheckout({ lineItems, customer, successUrl, failureUrl }) {
  const res = await fetch(`${HOST}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'X-Clover-Merchant-Id': process.env.CLOVER_MERCHANT_ID,
      Authorization: `Bearer ${process.env.CLOVER_PRIVATE_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      customer: customer || {},
      shoppingCart: {
        lineItems: lineItems.map((li) => ({
          name: li.name,
          price: li.priceCents, // cents
          unitQty: 1,
          note: li.note || ''
        }))
      },
      redirectUrls: {
        success: successUrl,
        failure: failureUrl
      }
    })
  });
  if (!res.ok) throw new Error(`Clover checkout failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    url: data.href || data.checkoutUrl,
    sessionId: data.checkoutSessionId || data.id || null
  };
}
