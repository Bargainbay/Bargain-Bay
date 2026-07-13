// Shared constants — safe for both server and client components (no fs, no env).

export const HST_RATE = 0.13;
export const DELIVERY_FEE = 79;

// ---- Interim payments (Stripe appeal in progress, June 2026) --------------
// Stripe paused card processing for the account pending a risk review. Until
// it's reinstated, online card checkout is OFF and customers pay by Interac
// e-transfer or in person on pickup/delivery. Flip back to true (and confirm
// STRIPE_SECRET_KEY is set) once Stripe reinstates the account.
export const CARD_PAYMENTS_ENABLED = false;

// ---- Per-unit tracker photos (PR#44) --------------------------------------
// The master tracker can carry a per-unit photo URL that the storefront prefers
// over the AJ Madison manufacturer photos. Temporarily OFF: the links that were
// loaded don't render publicly (Google Drive blocks image hotlinking, returning
// a login/403 instead of the photo), so cards showed broken images sitewide.
// With this off we fall back to the AJ Madison manufacturer photos as before.
// Flip back to true once the tracker holds real, publicly-renderable image URLs.
export const TRACKER_PHOTOS_ENABLED = false;

// Interac e-transfer destination shown at checkout / on the order page / in
// emails. Auto-deposit is on, so no security question is needed.
export const ETRANSFER_EMAIL = 'accounting@bargainbay.ca';
// Public contact / reply-to address. Domain email is now live, so this is the
// real @bargainbay.ca inbox. (The transactional "from" address is separate —
// see RESEND_FROM, which must stay on the verified bargainbay.ca domain.)
export const SALES_EMAIL = 'sales@bargainbay.ca';
// Post-delivery support contact (shown in the "Order Delivered" email).
export const CUSTOMER_SERVICE_EMAIL = 'customerservice@bargainbay.ca';
export const PICKUP_ADDRESS = '2764 Governors Road, Lynden, ON L0R 1T0';

// ---- Business identity (shown on invoices / packing slips) ----------------
export const BUSINESS_NAME = 'Bargain Bay';
export const BUSINESS_LEGAL = 'RS Solutions Inc.';
export const BUSINESS_ADDRESS = '2764 Governors Road, Lynden, ON L0R 1T0, Canada';
export const HST_NUMBER = '708490016 RT0001';
// Warehouse / dispatch mailbox — where packing slips are sent.
export const DISPATCH_EMAIL = 'dispatch@bargainbay.ca';
// Returns & warranty claims contact (matches /policies/returns + /policies/contact).
export const SERVICE_EMAIL = 'Service@rssolutions.ca';

// Condensed Returns & Refund policy for the invoice footer. The full version
// lives at /policies/returns — keep these in sync (this is the short form).
export const RETURN_POLICY_SUMMARY = [
  'Inspect at pickup/delivery. Report shipping damage, missing parts, or visible defects within 48 hours, with photos.',
  "Doesn't work on arrival (DOA): contact us within 48 hours for a repair, replacement, or full refund — your choice, at no cost.",
  'Not as described (wrong model / undisclosed major defect): tell us within 7 days for an exchange or full refund.',
  'Change of mind: return within 14 days if uninstalled, unused, and complete (all parts/manuals). Subject to a 20% restocking fee and return transport.',
  'One-year functional warranty on covered units (separate from returns): we repair or replace functional failures under normal household use. Cosmetic wear, customer damage, and improper installation are not covered.',
  '"As-Is" / "Final Sale" items and units that have been installed, used, or modified are not eligible for change-of-mind returns (DOA and warranty still apply where noted).'
];
// Google Business review link — powers the "Leave us a review" CTA in the
// delivered/picked-up email.
export const REVIEW_URL = 'https://g.page/r/CUvJK1IDy601EAI/review';

export const money = (n) =>
  '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const round2 = (n) => Math.round(n * 100) / 100;

// Warranty term shown on invoices. months: 3 | 6 | 12 (null = none).
export const warrantyLabel = (months) => {
  const m = Number(months);
  if (m === 12) return '1-year warranty';
  if (m === 3 || m === 6) return `${m}-month warranty`;
  return null;
};

// Homepage collections — mirror the old Shopify store's collections.
export const COLLECTIONS = [
  { slug: 'refrigerators',     label: 'Refrigerators',      cats: ['Refrigerator', 'Freezer'] },
  { slug: 'washers-dryers',    label: 'Washers & Dryers',   cats: ['Washer', 'Dryer', 'Laundry Center', 'Washer/Dryer Combo', 'Laundry Pedestal', 'Air Dresser'] },
  { slug: 'dishwashers',       label: 'Dishwashers',        cats: ['Dishwasher'] },
  { slug: 'ranges-ovens',      label: 'Ranges & Ovens',     cats: ['Range', 'Wall Oven', 'Warming Drawer'] },
  { slug: 'microwaves-hoods',  label: 'Microwaves & Hoods', cats: ['Microwave', 'Range Hood'] },
  { slug: 'under-500',         label: 'Deals under $500',   maxPrice: 500 }
];

export function collectionFilter(slug) {
  const col = COLLECTIONS.find((c) => c.slug === slug);
  if (!col) return () => true;
  return (u) =>
    (col.cats ? col.cats.includes(u.category) : true) &&
    (col.maxPrice ? u.price < col.maxPrice : true);
}

// Plain-English condition explainers shown on product pages.
export const CONDITIONS = {
  'New in Box': 'Brand new and unused, still in its original factory packaging.',
  'New Open Box': 'Brand new and never used — the box was opened (floor model, customer return, or repackaged). Full functionality, big savings.',
  'Scratch & Dent': 'Fully functional with cosmetic blemishes — a scratch or dent, often on a side or back panel that hides against a wall. Performance is not affected.',
  'Refurbished': 'Professionally inspected, repaired where needed, and bench-tested back to full working order by our technicians.',
  'Used': 'Previously owned. Bench-tested and confirmed working; expect normal signs of use.',
  'Tested & Working': 'Bench-tested by our technicians and confirmed fully functional before listing.'
};

export const STATUS_LABELS = {
  pending_payment: 'Pending payment',
  confirmed: 'Confirmed',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded'
};

export function pctOff(price, compareAt) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round((1 - price / compareAt) * 100);
}
