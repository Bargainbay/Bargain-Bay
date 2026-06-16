// Shared constants — safe for both server and client components (no fs, no env).

export const HST_RATE = 0.13;
export const DELIVERY_FEE = 79;
// Public contact / reply-to address. Uses the monitored Gmail inbox because
// sales@bargainbay.ca isn't set up to receive mail. (The transactional
// "from" address is separate — see RESEND_FROM, which must stay on the
// verified bargainbay.ca domain.)
export const SALES_EMAIL = 'bargain.bay.save@gmail.com';
export const PICKUP_ADDRESS = '2764 Governors Road, Lynden, ON L0R 1T0';

export const money = (n) =>
  '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const round2 = (n) => Math.round(n * 100) / 100;

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
  cancelled: 'Cancelled'
};

export function pctOff(price, compareAt) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round((1 - price / compareAt) * 100);
}
