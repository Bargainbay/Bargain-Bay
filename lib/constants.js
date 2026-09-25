// Shared constants — safe for both server and client components (no fs, no env).

// A number somebody has to dial off a screen or a sheet of paper, in a van.
// 4374888549 is not that. Anything that isn't ten digits is handed back
// untouched — a half-typed number is still the only number we have.
export const formatPhone = (v) => {
  const d = String(v || '').replace(/\D+/g, '');
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(v || '');
};

// The same number, spelled one way, for matching rather than for display.
// `formatPhone` above is what a person reads; this is what a lookup compares.
//
// ONE DEFINITION, because there were already three: lib/consent's normPhone,
// lib/drivers' e164, and lib/sarah-threads' normalizePhone — each slightly
// different, and a fourth was about to be written for customer identity. Two
// spellings of one number is how a suppression list gets holes in it and how a
// customer becomes two customers.
//
// Identical in behaviour to lib/consent's original, which is the most careful
// of the three: ten digits are assumed North American, eleven starting with 1
// are already that, and anything else is kept as given rather than guessed at.
export const phoneKey = (p) => {
  const digits = String(p || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
};

export const HST_RATE = 0.13;
export const DELIVERY_FEE = 79;

// Change-of-mind returns keep a restocking fee (see RETURN_POLICY_SUMMARY and
// /policies/returns — 20% is the published figure). The refund screen defaults
// to this and lets it be overridden per refund, because a goodwill exception is
// a decision the owner makes at the counter, not a code change.
// Nothing dated before this is pulled into the books by an automatic feed. The
// shop only started running on this system in August 2026; everything earlier
// lives in whatever was being used at the time, and importing it would produce a
// P&L that is half one system and half another. Overridable per-install via the
// `ledger_start` setting — see getLedgerStart() in lib/finance.js.
export const LEDGER_START_DEFAULT = '2026-08-01';

export const RESTOCKING_FEE_PCT = 20;
export const MAX_RESTOCKING_FEE_PCT = 50;

// ---- Invoice / order line kinds -------------------------------------------
// A line was only ever 'unit' or 'service', and every test in the codebase read
// "is it a service?" with "unit" as the else. Two more kinds broke that, so the
// question is now asked the other way round: `isUnitLine` is the one that
// decides whether a line carries a SKU, a warranty, a cost, and stock movement.
//
//   unit     — a physical appliance. The only kind that moves inventory.
//   service  — Installation / Delivery / Haul away / Door Removal. A charge,
//              no stock. A haul-away is a service and NOT a trade-in: we are
//              paid to take the old appliance away and dispose of it, rather
//              than crediting the customer for it (see INVOICE_SERVICES).
//   discount — money off the sale. Always negative.
//   trade_in — the customer's old appliance, taken in part-exchange. Always
//              negative, and the ONLY kind the delivery team has to physically
//              collect and bring back, which is why it isn't just a discount.
export const LINE_KINDS = {
  unit: 'Unit',
  service: 'Service',
  discount: 'Discount',
  trade_in: 'Trade-in'
};
// Kinds that are money coming OFF the sale. Stored negative, so a line total is
// always just SUM(amount) and nothing downstream needs to know about signs.
export const CREDIT_KINDS = ['discount', 'trade_in'];
export const isUnitLine   = (kind) => !kind || kind === 'unit';
export const isCreditLine = (kind) => kind === 'discount' || kind === 'trade_in';
export const normalizeLineKind = (kind) => (LINE_KINDS[kind] ? kind : 'unit');

// The one-tap service lines on the invoice form and the invoice editor. It lived
// as a copy-pasted array in both, which is the same way those two screens drifted
// before `InvoiceLines` was pulled out of them — so a service added to one was
// missing from the other, and reps found it on the new-invoice screen and not
// when they came back to correct the sale.
//
// A HAUL-AWAY IS NOT A TRADE-IN, and the difference is which way the money goes:
// the customer PAYS us to take their old machine away (a positive service line),
// where a trade-in is a credit against the sale. Both put something on the van
// going back, which is why `jobFromOrder` tags the dispatch job for either.
export const INVOICE_SERVICES = ['Installation', 'Delivery', 'Haul away', 'Door Removal'];

// Does this line read as a haul-away? Matched on the text because a haul-away is
// an ordinary service line with no kind of its own — one of INVOICE_SERVICES, or
// whatever the rep typed ("haul away old fridge", "haulaway"). Used to tag the
// dispatch job so the crew knows to make room on the truck.
export const isHaulAwayLine = (kind, text) =>
  kind === 'service' && /haul[\s-]?away|haulaway/i.test(String(text || ''));

// ---- Where the sale came from --------------------------------------------
//
// How the CUSTOMER reached us, as stated by the person who took the sale — a
// different fact from `orders.source`, which is first-touch web attribution
// derived from a UTM tag or a referrer (see lib/attribution.js). One is machine-
// read and only ever exists for a storefront visit; this one is a human's
// answer, and it is the only thing that can ever explain a walk-in. They are
// kept in separate columns so neither overwrites the other: an ad-driven web
// order keeps its channel AND reads as a website lead.
//
// A fixed list, not free text, so the answers stay countable — same reasoning as
// jobs.services. Anything unusual goes to `other` and is explained in `leadBy`.
export const LEAD_SOURCES = {
  walk_in:     'Walk-in',
  // 'website' is stamped directly by the storefront checkout (app/api/checkout)
  // on every order it creates — a checkout IS a website lead, so nobody has to
  // type it. Renaming this key means changing that INSERT too.
  website:     'Website',
  phone:       'Phone enquiry',
  facebook:    'Facebook / Instagram',
  marketplace: 'Facebook Marketplace',
  kijiji:      'Kijiji',
  google:      'Google search',
  referral:    'Referral / word of mouth',
  repeat:      'Repeat customer',
  trade:       'Contractor / property manager',
  other:       'Other'
};
// Sources that are meaningless without a name attached: "a referral" from nobody
// in particular is the answer that gets typed when the rep is in a hurry, and it
// is exactly the one the owner opens this report to chase.
export const LEAD_SENDER_REQUIRED = ['referral', 'trade'];
export const leadSourceLabel = (key) => LEAD_SOURCES[key] || null;
// Accepts a key or the label it displays as (an imported or spoken answer comes
// back as words), and returns the key — or null, which means "nobody said".
export function normalizeLeadSource(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (LEAD_SOURCES[s]) return s;
  const hit = Object.keys(LEAD_SOURCES).find((k) => LEAD_SOURCES[k].toLowerCase() === s);
  return hit || null;
}

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
export const PICKUP_ADDRESS = '1135 Squires Beach Rd, Pickering, ON L1W 3T9';
// Showroom / pickup hours (also drives the bookable slots in lib/pickup.js).
export const BUSINESS_HOURS = 'Open 7 days, 10am–8pm';

// ---- Business identity (shown on invoices / packing slips) ----------------
export const BUSINESS_NAME = 'Bargain Bay';
export const BUSINESS_LEGAL = 'RS Solutions Inc.';
export const BUSINESS_ADDRESS = '1135 Squires Beach Rd, Pickering, ON L1W 3T9, Canada';
export const HST_NUMBER = '708490016 RT0001';
// Warehouse mailbox on the STOREFRONT side — where a Bargain Bay packing slip is
// emailed to be picked. Not the delivery desk below; the two are one letter apart
// and do different jobs.
export const DISPATCH_EMAIL = 'dispatch@bargainbay.ca';
// Returns & warranty claims contact (matches /policies/returns + /policies/contact).
export const SERVICE_EMAIL = 'Service@rssolutions.ca';
// The RS Solutions DELIVERY DESK — the dispatch coordinator's mailbox. Every
// delivery conversation is meant to land here rather than in the owner's Service@
// inbox: the office copy of a completion, a couldn't-complete, an import that
// needs a decision, and the reply-to on anything a dispatch client receives.
//
// Read through dispatchDesk() rather than directly, so it can be moved with the
// DISPATCH_EMAIL env var (set on Vercel, then redeploy) without a code change.
export const RS_DISPATCH_EMAIL = 'dispatch@rssolutions.ca';
export const dispatchDesk = () => process.env.DISPATCH_EMAIL || RS_DISPATCH_EMAIL;

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

// Warranty term shown on invoices. months: 3 | 6 | 12 | 24 (null = none).
export const warrantyLabel = (months) => {
  const m = Number(months);
  if (m === 24) return '2-year warranty';
  if (m === 12) return '1-year warranty';
  if (m === 3 || m === 6) return `${m}-month warranty`;
  return null;
};

// Homepage collections — mirror the old Shopify store's collections.
export const COLLECTIONS = [
  { slug: 'refrigerators',     label: 'Fridges & Freezers', cats: ['Refrigerator', 'Freezer', 'Beverage Center', 'Wine Cooler'] },
  { slug: 'washers-dryers',    label: 'Washers & Dryers',   cats: ['Washer', 'Dryer', 'Laundry Center', 'Washer/Dryer Combo', 'Laundry Pedestal', 'Air Dresser'] },
  { slug: 'dishwashers',       label: 'Dishwashers',        cats: ['Dishwasher'] },
  { slug: 'ranges-ovens',      label: 'Ranges & Ovens',     cats: ['Range', 'Wall Oven', 'Warming Drawer', 'Cooktop'] },
  { slug: 'microwaves-hoods',  label: 'Microwaves & Hoods', cats: ['Microwave', 'Range Hood'] },
  { slug: 'tvs',               label: 'TVs',                cats: ['Television', 'TV'] },
  { slug: 'small-appliances',  label: 'Small Appliances',   cats: ['Small Appliance', 'Vacuum', 'Air Conditioner', 'Dehumidifier', 'Air Purifier', 'Water Dispenser'] },
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
  'New Scratch & Dent': 'Brand new and never used, with a cosmetic blemish from transit or handling — often on a side or back panel that hides against a wall. Performance is not affected.',
  'Scratch & Dent': 'Fully functional with cosmetic blemishes — a scratch or dent, often on a side or back panel that hides against a wall. Performance is not affected.',
  'Refurbished': 'Professionally inspected, repaired where needed, and bench-tested back to full working order by our technicians.',
  'Used': 'Previously owned. Bench-tested and confirmed working; expect normal signs of use.',
  'Tested & Working': 'Bench-tested by our technicians and confirmed fully functional before listing.'
};

// The business runs on Toronto time and the servers run on UTC, so ANY date or
// time rendered on the server has to say which zone it means. Left to the
// default, a 4:02pm delivery is emailed to the office as 8:02pm, and a stop
// finished after 8pm prints TOMORROW's date on the form the customer signed.
export const TZ = 'America/Toronto';

// The longest shift that is still a real day's work. Past it, a shift is taken
// to be a clock-off nobody tapped until the next morning: the Profit tab leaves
// it out of Crew (and counts it), the Times tab marks it "not costed", and the
// shift editors refuse to type one in. ONE number for all three, so a shift the
// office can save is never a shift the report then refuses.
//
// It was 14 on the Profit/Times side and 20 in the editors. 14 was wrong for
// this crew: long drives put Ruban and Kowsi past it on genuine, clocked-off
// days (owner, 2026-09-14). The broken shifts it exists to catch were 83 and
// 191 hours, nowhere near the line.
export const MAX_SHIFT_HOURS = 20;
export const torontoTime = (v) =>
  (v ? new Date(v).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : null);
export const torontoDate = (v) =>
  (v ? new Date(v).toLocaleDateString('en-CA', { timeZone: TZ }) : null);

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

// The ONE list of what we buy. Three copies of this had drifted — the intake
// dropdown, the AI invoice reader, and RS Ops — which is how "Laundry Center"
// reached RS Ops as a category it had never heard of, silently landing the unit
// on the wrong cleaning checklist and leaving it unsubmittable.
//
// A laundry centre (two drums in one shell), a washer-dryer combo (one drum that
// washes then dries) and an all-in-one are three DIFFERENT machines and are
// tested and cleaned differently downstream — they cannot share one word.
export const INTAKE_CATEGORIES = [
  'Refrigerator', 'Freezer',
  'Washer', 'Dryer', 'Laundry Centre', 'Washer Dryer Combo', 'All in One',
  'Dishwasher',
  'Range', 'Wall Oven', 'Cooktop', 'Range Hood', 'Microwave',
  'TV', 'Vacuum', 'Small Appliance',
  'Other'
];

// The ONE list of conditions a unit can be TAKEN IN as, for the same reason
// INTAKE_CATEGORIES above is one list. It had already drifted: the vendor
// drop-off form still offered the retired 'Scratch & Dent' and 'Used' after
// they were renamed, and a rep picking a retired label writes a string the
// tracker's pricing tiers do not match — no Condition %, no price, and
// lib/csv.js drops the row without a word. The unit is added, synced, and never
// appears.
//
// NOT the same list as the shop's condition FILTER (app/shop/ShopClient.jsx),
// which deliberately keeps the retired labels: live stock still carries them,
// and dropping an option there hides real units. You can no longer take a unit
// IN as one; you can still find the ones that already are.
export const INTAKE_CONDITIONS = [
  'New in Box', 'New Open Box', 'New Scratch & Dent', 'Refurbished'
];

// ── Stock a vendor dropped off is never sold thin ───────────────────────────
// Consigned units (today: Abi's) are ours to sell and somebody else's to be
// paid for, so a thin sale is not a thin margin — it is our money going out.
// The owner's rule (2026-09-22): at least cost + 20%.
//
// THE TWO SIDES ARE QUOTED DIFFERENTLY AND THAT IS THE WHOLE TRAP. Abi's costs
// are TAX-INCLUDED and he gives us no HST invoice, so $1,600 is $1,600 out of
// the bank with nothing to claim back. Our prices are PRE-TAX: the HST a
// customer pays on top is collected for the CRA, not earned. So the comparison
// is our PRE-TAX price against his FULL cost — comparing a tax-in price to it
// would look like a $200 margin on a unit that actually made nothing.
export const CONSIGNMENT_MIN_MARGIN_PCT = 20;

// CEIL, not round: a floor that rounds down is not a floor.
export function consignmentFloor(cost) {
  const c = Number(cost) || 0;
  if (!(c > 0)) return 0;                 // a cost of 0 (haul-away) floors nothing
  return Math.ceil(c * (1 + CONSIGNMENT_MIN_MARGIN_PCT / 100));
}
