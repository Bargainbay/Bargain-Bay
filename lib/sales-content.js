// What John says, by segment — the Sales Hub's Resources page and the printable leave-behinds read this.
//
// Rewritten 2026-11-09 from the Drive docs ("RS Sales – Segment Pitches" and the Business Development Sales Toolkit) so that
// EVERYTHING in it can be honoured on job one:
//   · every price is the 2026 Delivery Rate Sheet (zones here, installations and haul-away from lib/addons.js — one source);
//   · every promise matches the rate sheet's own terms (orders in by 3:00 p.m. the day before, scheduling 2–3 days out, no
//     statutory holidays, same-floor moves only, haul-away of the SAME TYPE as the appliance delivered, photographs and a
//     signed proof of delivery on every drop) — so there is no "same day", "next day" or "emergency" anywhere;
//   · nothing is claimed that is not confirmed: the company is insured (owner, 2026-11-09). WSIB registration is NOT confirmed,
//     so nothing here mentions it and restoration is held back until it is (see `hold`).
// test/sales-content.test.mjs pins all of that. Merge fields: {first_name} {company} {rep_name} {rep_phone}.
import { ADDONS } from './addons';

export const ZONES = [
  { key: 'A', km: '0–50 km', price: 95 },
  { key: 'B', km: '51–100 km', price: 140 },
  { key: 'C', km: '101–150 km', price: 225 }
];
const addon = (key) => ADDONS.find((a) => a.key === key);
const $ = (n) => `$${n}`;

// The prices a rep may quote, in one list (also printed on the leave-behinds).
export const PRICE_LIST = [
  ...ZONES.map((z) => ({ item: `Delivery, Zone ${z.key} (${z.km} from the pickup location)`, price: $(z.price) })),
  { item: 'Haul-away of the old appliance (same type as the one delivered)', price: `${$(addon('haul_away').price)} per appliance` },
  { item: 'Laundry installation (no gas; customer supplies hoses)', price: $(addon('laundry_install').price) },
  { item: 'Stacking or pedestal laundry installation', price: $(addon('laundry_stack').price) },
  { item: 'Dishwasher installation (uninstall + install)', price: $(addon('dishwasher_install').price) },
  { item: 'Electric wall oven installation (uninstall + install)', price: $(addon('wall_oven_install').price) },
  { item: 'Over-the-range microwave or vented range hood installation', price: $(addon('otr_install').price) },
  { item: 'Gas dryer or range installation (existing hookup)', price: $(addon('gas_install').price) },
  { item: 'Fridge waterline: connect existing / new line up to 20 ft', price: `${$(addon('fridge_waterline_existing').price)} / ${$(addon('fridge_waterline_new').price)}` },
  { item: 'Additional pieces after the second on one delivery', price: '$15 each' },
  { item: 'Overweight product (over 350 lbs)', price: '$75' },
  { item: 'Fridge door removal, home door removal, same-floor internal move', price: '$20 each' }
];

// What we promise, and what we do not — so nobody on a call has to guess.
export const WE_PROMISE = [
  'We schedule within 2–3 days of the order. Regular accounts can have set days.',
  'Orders in by 3:00 p.m. the day before the delivery day; we confirm a 3-hour window.',
  'Every delivery is photographed and every proof of delivery is signed; photos and times are in the client portal.',
  'The company is insured.',
  'Delivery and installation by our own trained crews, from the Pickering warehouse.',
  'Prices are the rate sheet above; there is no minimum order and no exclusivity.'
];
export const WE_DO_NOT = [
  'Same-day or next-day service, or emergency call-outs.',
  'Deliveries on statutory holidays.',
  'Moving appliances to another floor, or removing doors, railings or trim to get a unit in.',
  'Hauling away anything but the same type of appliance we deliver (no general junk or dump runs).',
  'New gas lines, vents, wiring or plumbing — the customer arranges those first.',
  'Restoration pack-out or storage (not priced or set up).',
  'Naming WSIB or certificates until they are confirmed.'
];

export const PITCH =
  'RS Solutions is a one-stop appliance partner for the GTA: we sell tested appliances through our Bargain Bay outlet, and our own crews deliver, install and haul away — scheduled within 2–3 days, every drop photographed.';

// The three rules every script follows (from the Drive call scripts).
export const RULES = [
  'A question inside fifteen seconds. A pitch invites a no; a question invites an answer.',
  'Sell the first small yes, not the account. You win the portfolio on job three.',
  'Log it before the next dial. Attempt four is where these close, and most callers stop at two.'
];

const SIGN = '{rep_name} · RS Solutions · 1135 Squires Beach Rd, Pickering · reply STOP to unsubscribe';

export const SEGMENT_PITCHES = [
  {
    key: 'property_management', label: 'Property management', order: 1, startNow: true,
    why: 'Recurring forever: a building generates appliance work every week. Longest cycle, biggest prize. Start with the ones that operate buildings.',
    watch: 'Gatekeepers, incumbent vendors, net-30 payment, and the big ones need a vendor form first.',
    offer: [
      'Appliances for the units: tested refurbished and open-box from Bargain Bay at a fraction of new, with delivery and installation in one order.',
      'Delivery $95 / $140 / $225 by zone, installs and haul-away priced per appliance (list below).',
      'Scheduled 2–3 days out; set days for turnovers once you are a regular.',
      'Every drop photographed and signed for, in a client portal they can open.',
      'Be the backup vendor, not the replacement. Smallest possible yes.'
    ],
    opener: 'Hi {first_name}, it is {rep_name} at RS Solutions. We supply and install appliances for building owners across the GTA. Quick one: when a unit needs a fridge or a stove, who do you call right now — and how long does it take them to get there?',
    smallYes: '"Could we quote your next unit turnover? One unit, delivery and install."',
    ifThey: 'If they have someone: "Are they getting to you within a few days, or is that the part that hurts?" — then ask only to be the backup number.',
    email: { subject: 'appliances for your units, delivered and installed', body: `Hi {first_name}, {rep_name} at RS Solutions. We sell tested refurbished and open-box appliances well under new and deliver, install and haul away the old unit in one order, scheduled within 2–3 days. Every delivery is photographed and signed for.\n\nNot asking for your vendor list. If a unit in one of your buildings needs a fridge, stove or washer, send me the model and I will quote the appliance, delivery and install together.\n\n${SIGN}` }
  },
  {
    key: 'retailer', label: 'Appliance and furniture retail', order: 2, startNow: true,
    why: 'Cleanest fit: their pain is lumpy volume — an idle truck one day, a pile of deliveries the next. Short decision chain; the owner is usually there.',
    watch: 'Skip the national chains (logistics are contracted nationally). Seasonal. They know what a truck costs.',
    offer: [
      'Overflow delivery and installation: there when you are stacked, no minimum, no exclusivity.',
      'Delivery by zone from $95; installs and haul-away priced per appliance (list below).',
      'Photographed and signed on every drop, which ends the scratch argument.',
      'Old appliance hauled away on the same trip ($20 per appliance, same type as delivered).',
      'We can also take their returns, scratch-and-dent and overstock off their hands through Bargain Bay.'
    ],
    opener: 'Hi, is the owner about? ... {rep_name} from RS Solutions. We do delivery and install for appliance retailers in the GTA. Is your delivery in-house at the moment, or contracted out?',
    smallYes: '"One route — the next time you have more deliveries than truck."',
    ifThey: 'If they own a van: "Great — we are only for the days it is full. Orders in by 3 p.m. the day before and we are there within 2–3 days."',
    email: { subject: 'overflow delivery and install, no minimum', body: `Hi, {rep_name} at RS Solutions. We deliver and install appliances across the GTA for retailers who do not want to own another truck.\n\nNo minimum, no exclusivity: we are the overflow for when deliveries stack up. Every drop is photographed and signed for, the old unit can be hauled away on the same trip, and orders in by 3 p.m. the day before are scheduled within 2–3 days.\n\nWorth trying one route?\n\n${SIGN}` }
  },
  {
    key: 'contractor', label: 'Contractors and renovators', order: 3, startNow: true,
    why: 'Largest list and the easiest first yes. Small jobs, but they repeat once you are the number they call. Ninety seconds of attention on a site.',
    watch: 'Lowest value per job, so volume is the only way it pays. Many are one-person shops. Slow payers: settle terms on job one.',
    offer: [
      'Appliances for the job, delivered and installed on the day they land, so the trades stay on the work.',
      'Installs priced per appliance: dishwasher $120, laundry $40, wall oven $175, over-the-range $125, gas range or dryer $250.',
      'Haul-away of the old appliances on the same visit, $20 each.',
      'Scheduled 2–3 days out — book it when you order the appliances.'
    ],
    opener: 'Hi, {rep_name} at RS Solutions. We deliver and install appliances for contractors across the GTA. Who handles the appliance install on your jobs at the moment?',
    smallYes: '"One install day."',
    ifThey: 'If their crew does it: "Fair. We are for the weeks you would rather not pull them off the job — book it with the appliance order."',
    email: { subject: 'appliance install, booked with the order', body: `Hi, {rep_name} at RS Solutions. We supply, deliver and install appliances for GTA contractors, and haul the old ones away on the same visit.\n\nDishwasher install $120, laundry $40, wall oven $175, over-the-range $125, gas range or dryer $250; haul-away $20 each. Scheduled within 2–3 days.\n\nNext time appliances are due on a job, send me the list and I will price it.\n\n${SIGN}` }
  },
  {
    key: 'builder', label: 'Home builders and developers', order: 4,
    why: 'Biggest jobs in the list and scheduled far ahead. Bargain Bay gives an answer on appliance supply, not just labour.',
    watch: 'Slowest cycle, a vendor package, progress-draw payment terms, and they may already be locked to a supplier who installs.',
    offer: [
      'Appliance supply from Bargain Bay where a spec allows, with delivery and installation across a closing run.',
      'Orders placed ahead, so units are scheduled to the closing rather than sitting on a site.',
      'White-glove placement (into the room, unboxed, levelled) priced per the rate sheet; packaging removed.',
      'Every unit photographed and signed for.'
    ],
    opener: 'Hi, {rep_name} from RS Solutions. We deliver and install appliances on new builds across the GTA. Who is handling appliance install on your current sites — the supplier or your own trades?',
    smallYes: '"One closing run, or a single floor."',
    ifThey: 'If "the supplier does it": "Does that include getting them into the suite and the packaging out? That is usually the part that lands back on your site super."',
    email: { subject: 'appliance delivery and install on closing runs', body: `Hi, {rep_name} at RS Solutions. We deliver and install appliance packages on new residential builds across the GTA: scheduled to your closing, placed in the room, packaging removed, every unit photographed and signed for.\n\nWe can work alongside your existing supplier. Happy to price one closing run.\n\n${SIGN}` }
  },
  {
    key: 'storage_moving', label: 'Self storage and moving companies', order: 5,
    why: 'Immediately transactional. Storage facilities meet customers at the moment they need a mover — a referral channel, not just a customer.',
    watch: 'Half of them are competitors, so open with the appliance specialism. Do not become cheap overflow labour.',
    offer: [
      'To storage facilities: be the name they hand to customers who need appliances moved or installed. Costs them nothing.',
      'The appliance specialism most movers avoid: disconnect and reconnect, installation, haul-away — priced per appliance.',
      'To moving companies: we take the appliances they would rather not. No exclusivity.'
    ],
    opener: 'Hi, {rep_name} from RS Solutions. When somebody rents a unit and says they still need an appliance moved or installed, do you hand them a name, or do they sort it themselves?',
    smallYes: '"Be the name at the front desk" / "one appliance job."',
    ifThey: 'If they have a preferred mover: "We are only for the appliances — fridges, washers, ranges. Do you ever get asked for those?"',
    email: { subject: 'a name for customers who need an appliance moved', body: `Hi, {rep_name} at RS Solutions. We deliver, install and haul away appliances across the GTA, including disconnect and reconnect, which most movers will not touch.\n\nWhen a customer needs an appliance handled, we would like to be the name you give them. No cost to you. Can I drop off a few cards?\n\n${SIGN}` }
  },
  {
    key: 'realtor', label: 'Real estate brokerages', order: 6,
    why: 'One office manager who recommends you reaches the whole office. Lowest value per contact, so it comes after the others.',
    watch: 'Agents are transient. Ask for the office manager, never an individual agent. Getting on a vendor list means paperwork: do it right away.',
    offer: [
      'Appliances for listings and new buyers — tested refurbished and open-box, delivered and installed.',
      'A referral reward for agents who send clients (the Bargain Bay referral program).',
      'A one-pager the agents can keep.'
    ],
    opener: 'Hi, I am looking for whoever your agents ask when a listing needs an appliance or a client needs one installed. Is there a preferred-vendor list, or is it whoever they know?',
    smallYes: '"Get on the vendor list" / "one listing."',
    ifThey: 'If there is a list: ask what it takes to get on, and complete it while the call is live.',
    email: { subject: 'appliances for listings, delivered and installed', body: `Hi, {rep_name} at RS Solutions. We supply tested appliances at well under new and deliver and install them across the GTA, scheduled within 2–3 days. Agents who refer a client are rewarded through our referral program.\n\nHappy to send a one-pager your agents can keep.\n\n${SIGN}` }
  },
  {
    key: 'restoration', label: 'Restoration and insurance contractors', order: 7,
    hold: 'ON HOLD until the owner confirms the compliance paperwork these firms expect. Do not call this segment yet.',
    why: 'Large insurer-paid tickets, but the ask depends on compliance paperwork that is not confirmed.',
    watch: 'They judge you on speed and expect compliance certificates. We do not offer rush service: our scheduling is 2–3 days.',
    offer: [
      'Replacement appliances for a loss: tested refurbished units, delivered and installed, scheduled within 2–3 days.',
      'Photographed delivery and installation for the claim file.'
    ],
    opener: '(Not to be used until released.)',
    smallYes: '"Be on the list for appliance replacements."',
    ifThey: '—',
    email: { subject: 'appliance replacements for claims', body: `Hi, {rep_name} at RS Solutions. We supply, deliver and install replacement appliances for insured losses, scheduled within 2–3 days, with photographed delivery for the claim file.\n\n${SIGN}` }
  },
  {
    key: 'stager', label: 'Home staging', order: 8,
    why: 'Small, owner-run, one decision-maker. The smallest segment: an afternoon, not a week.',
    watch: 'Low ticket, many own a van. We have no set staging or storage price, so quote anything beyond appliances as custom.',
    offer: [
      'Appliances for staged homes, delivered and installed.',
      'Moving and delivery work as a custom quote.'
    ],
    opener: 'Hi, {rep_name} at RS Solutions. We do appliance delivery and moving across the GTA. When you stage or de-stage, is that your own crew and truck, or do you bring someone in?',
    smallYes: '"One job."',
    ifThey: 'If they have their own crew: "Fine — we are for the appliances and the heavy items you would rather not lift."',
    email: { subject: 'appliances and heavy lifting for staging jobs', body: `Hi, {rep_name} at RS Solutions. We deliver, install and move appliances across the GTA, scheduled within 2–3 days, every drop photographed.\n\nIf a staging job has a fridge, range or washer in it, send me the details and I will quote it.\n\n${SIGN}` }
  }
];

export const FIRST_TWO_WEEKS =
  'Weeks 1–2: property management, retailers and contractors only (builders as a slow burn alongside). Everything else waits for the first month’s results. A segment marked on hold is not to be called.';

export const FOLLOW_UP = {
  subject: 'Following up',
  body: 'Hi {first_name}, just bumping this up. Happy to start small with one job — send me the appliance and the address and I will price it. Does Tuesday or Thursday suit for a quick call?\n\n{rep_name}'
};

export const OBJECTIONS = [
  { says: 'We already have a vendor.', reply: 'Makes sense. Most clients keep theirs and use us as the second call. Can we be your backup for the next job?' },
  { says: 'Too expensive.', reply: 'Let us price one real job side by side, including how long you wait and how many visits it takes. The appliance, delivery and install come as one number.' },
  { says: 'Can you do it today?', reply: 'Not same-day — we schedule within 2–3 days, with orders in by 3 p.m. the day before. If you plan with us, we are dependable.' },
  { says: 'Not right now.', reply: 'No problem. When does your next turnover or busy season start? I will check in then.' },
  { says: 'Send me info.', reply: 'Will do. What is the one thing you would most want fixed, so I send the right one-pager?' }
];

export const PIPELINE_NOTE =
  'New lead → Contacted → Conversation → Meeting booked → Proposal sent → Won (paid) → Repeat/upsell. Commission counts only once the client has paid.';

export const WEEKLY_CHECKIN =
  'Every Friday: review touches, meetings, proposals, Collected Sales against the pace, the top five deals, and what is blocking them.';

/** What each segment's leave-behind says: the headline, what we do for them, and the real prices. */
export function leaveBehind(key) {
  const s = SEGMENT_PITCHES.find((x) => x.key === key);
  if (!s) return null;
  return {
    key: s.key, label: s.label,
    headline: `Appliances for ${s.label.toLowerCase()}: supplied, delivered and installed.`,
    bullets: s.offer,
    promises: WE_PROMISE,
    prices: PRICE_LIST
  };
}
