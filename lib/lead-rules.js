// The lead tracker's fixed vocabulary. NO IMPORTS: the browser forms use it too.
//
// Fixed lists, not free text, for the same reason LEAD_SOURCES and
// jobs.services are: one answer spelled four ways is four buckets and a report
// nobody can count.

export const SIDES = [
  { key: 'bb', label: 'Bargain Bay' },
  { key: 'rs', label: 'RS Solutions' },
  { key: 'both', label: 'Both (shows under All only)' }
];

export const SEGMENTS = [
  // The eight segments the pitches are written for (lib/sales-content.js), then the rest.
  ['property_management', 'Property management'],
  ['retailer', 'Appliance / furniture retailer'],
  ['contractor', 'Contractor / renovator'],
  ['builder', 'Home builder / developer'],
  ['storage_moving', 'Self storage / moving company'],
  ['realtor', 'Real estate / realtor'],
  ['restoration', 'Restoration / insurance contractor'],
  ['stager', 'Home staging'],
  ['reseller', 'Reseller / flipper'],
  ['logistics', 'Logistics company'],
  ['general_business', 'General business (AI)'],
  ['affiliate', 'Affiliate partner'],
  ['other', 'Other']
];

export const INTEREST_TAGS = [
  ['appliance_purchase', 'Appliance purchase'],
  ['repair', 'Repair'],
  ['maintenance', 'Maintenance contract'],
  ['installation', 'Installation'],
  ['delivery', 'Delivery / moving'],
  ['car_hauling', 'Car hauling'],
  ['handyman', 'Handyman / renovation'],
  ['ai_integration', 'AI integration'],
  ['ai_tracking', 'AI delivery tracking'],
  ['liquidation', 'Liquidation'],
  ['reseller_account', 'Reseller account'],
  ['affiliate', 'Affiliate']
];

export const LEAD_SOURCES_HUB = [
  ['self_sourced', 'Self-sourced'],
  ['assigned', 'Assigned by owner'],
  ['website', 'Website form'],
  ['chat', 'Bay chat widget'],
  ['google_ads', 'Google Ads'],
  ['marketplace', 'Marketplace'],
  ['referral', 'Referral / affiliate'],
  ['walk_in', 'Walk-in'],
  ['imported', 'Imported list'],
  // Added for the lead log (/admin/lead-log): where the everyday inbound leads actually come from.
  ['phone', 'Phone call'],
  ['social', 'Facebook / Instagram'],
  ['lead_team', 'Lead generation team'],
  ['partner', 'Partner (SecondShop, Aljo, ...)']
];

// Won is not on the rep's menu: a deal is Won when the payment is recorded
// (Collected Sales), never because somebody dragged a card.
export const STAGES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['conversation', 'Conversation'],
  ['meeting', 'Meeting booked'],
  ['proposal', 'Proposal / quote sent'],
  ['won', 'Won (paid)'],
  ['lost', 'Lost']
];
export const OPEN_STAGES = ['new', 'contacted', 'conversation', 'meeting', 'proposal'];

export const TEMPERATURES = ['cold', 'warm', 'hot'];

export const ACTIVITY_TYPES = [
  ['call', 'Call'],
  ['email', 'Email'],
  ['whatsapp', 'WhatsApp'],
  ['text', 'Text'],
  ['meeting', 'Meeting'],
  ['site_visit', 'Site visit'],
  ['walk_in', 'Walk-in'],
  ['linkedin', 'LinkedIn'],
  ['note', 'Note']
];
// A note is not outreach. Everything else counts as a touch.
export const TOUCH_KINDS = ['call', 'email', 'whatsapp', 'text', 'meeting', 'site_visit', 'walk_in', 'linkedin'];

export const OUTCOMES = [
  ['no_answer', 'No answer'],
  ['voicemail', 'Voicemail'],
  ['conversation', 'Conversation'],
  ['meeting_booked', 'Meeting booked'],
  ['proposal_sent', 'Proposal / quote sent'],
  ['not_interested', 'Not interested']
];

export const LOST_REASONS = [
  ['price', 'Price'],
  ['has_vendor', 'Has a vendor'],
  ['no_need', 'No need'],
  ['no_response', 'No response'],
  ['wrong_number', 'Wrong number'],
  ['junk', 'Junk / not a real lead'],
  // The two the lead log exists to count. "No stock" is the one the owner wants measured: a buyer who wanted something we
  // did not have on the floor. It is a reason on its own, not a kind of "other", so the funnel can say how many sales were
  // lost to supply rather than to price or interest.
  ['no_stock', 'We did not have what they wanted'],
  ['timing', 'Not ready to buy yet'],
  ['other', 'Other']
];

// What a buyer asked for, as a fixed list so "what did we not have" can be counted. The free-text `wanted` carries the
// model or the detail; the category is the bucket.
export const WANTED_CATEGORIES = [
  ['refrigerator', 'Refrigerator'],
  ['range', 'Range / stove'],
  ['cooktop', 'Cooktop'],
  ['wall_oven', 'Wall oven'],
  ['dishwasher', 'Dishwasher'],
  ['washer', 'Washer'],
  ['dryer', 'Dryer'],
  ['laundry_set', 'Washer and dryer set'],
  ['microwave', 'Microwave / hood'],
  ['freezer', 'Freezer'],
  ['other', 'Something else']
];

// From the sales toolkit: the daily activity targets.
export const DAILY_TARGETS = { touches: 40, conversations: 10, meetings: 3, proposals: 1 };

export const FIRST_TOUCH_HOURS = 24;
export const OWNERSHIP_DAYS = 60;

const keyOf = (list) => new Set(list.map((x) => (Array.isArray(x) ? x[0] : x.key ?? x)));
export const isStage = (s) => keyOf(STAGES).has(s);
export const isSide = (s) => keyOf(SIDES).has(s);

const pick = (v, list, fallback) => (keyOf(list).has(v) ? v : fallback);

/** Clean a lead's input. Unknown vocabulary answers become NULL / defaults, never new buckets. */
export function normalizeLeadFields(f = {}) {
  const s = (v, max = 300) => { const t = String(v == null ? '' : v).trim().slice(0, max); return t || null; };
  const tags = (Array.isArray(f.interestTags) ? f.interestTags : [])
    .map(String).filter((t) => keyOf(INTEREST_TAGS).has(t));
  const value = f.estValue === '' || f.estValue == null ? null : Number(f.estValue);
  return {
    side: pick(f.side, SIDES, 'both'),
    company: s(f.company),
    contactName: s(f.contactName),
    email: s(f.email, 200)?.toLowerCase() || null,
    phone: s(f.phone, 40),
    address: s(f.address, 300),
    segment: f.segment && keyOf(SEGMENTS).has(f.segment) ? f.segment : null,
    source: f.source && keyOf(LEAD_SOURCES_HUB).has(f.source) ? f.source : null,
    utmSource: s(f.utmSource, 100),
    utmCampaign: s(f.utmCampaign, 100),
    interestTags: [...new Set(tags)],
    temperature: pick(f.temperature, TEMPERATURES, 'cold'),
    wanted: s(f.wanted, 200),
    wantedCategory: f.wantedCategory && keyOf(WANTED_CATEGORIES).has(f.wantedCategory) ? f.wantedCategory : null,
    sourceDetail: s(f.sourceDetail, 100),
    estValue: Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null,
    nextStep: s(f.nextStep, 300),
    nextStepAt: /^\d{4}-\d{2}-\d{2}$/.test(String(f.nextStepAt || '')) ? f.nextStepAt : null
  };
}

/** Merge fields for an email template: {first_name} {company} {rep_name} {rep_phone}. */
export function mergeTemplate(text, vars = {}) {
  return String(text || '').replace(/\{(first_name|company|rep_name|rep_phone)\}/g, (_, k) => vars[k] ?? '');
}
