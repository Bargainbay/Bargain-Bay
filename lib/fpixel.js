// lib/fpixel.js
// Meta Pixel ID + every event helper. content_ids here MUST match the `id`
// (SKU) in the product feed (app/feed/route.js) so dynamic ads can retarget.

export const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;

export const newEventId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const pageview = () => {
  if (typeof window !== 'undefined' && window.fbq) window.fbq('track', 'PageView');
};

export const track = (name, params = {}, options = undefined) => {
  if (typeof window !== 'undefined' && window.fbq) window.fbq('track', name, params, options);
};

export const viewContent = ({ id, name, value, currency = 'CAD' }, eventId) =>
  track('ViewContent', {
    content_ids: [String(id)],
    content_name: name,
    content_type: 'product',
    value,
    currency,
  }, eventId ? { eventID: eventId } : undefined);

export const addToCart = ({ id, name, value, currency = 'CAD', quantity = 1 }, eventId) =>
  track('AddToCart', {
    content_ids: [String(id)],
    content_name: name,
    content_type: 'product',
    contents: [{ id: String(id), quantity }],
    value,
    currency,
  }, eventId ? { eventID: eventId } : undefined);

export const initiateCheckout = ({ ids = [], value, currency = 'CAD', numItems }, eventId) =>
  track('InitiateCheckout', {
    content_ids: ids.map(String),
    content_type: 'product',
    num_items: numItems ?? ids.length,
    value,
    currency,
  }, eventId ? { eventID: eventId } : undefined);

// No Purchase helper on purpose: it is sent from the server once an order is
// paid (lib/meta-purchases.js), never from the browser.

// deploy marker 20260616T034543Z — force clean rebuild so NEXT_PUBLIC_FB_PIXEL_ID inlines
