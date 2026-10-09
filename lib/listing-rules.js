// What a marketplace listing must look like before a human is asked to look at it.
// Pure: it runs on the server at submit time and in the vendor's browser to show
// the completeness meter, and both must give the same answer. See
// docs/marketplace/PLAN.md §6–§7.
import { INTAKE_CONDITIONS, COLLECTIONS } from './constants';
import { WARRANTY_MONTHS, warrantyOk } from './marketplace-rules';

// Phase 1 is major appliances only, taken from the storefront's own categories so
// the marketplace never grows a parallel tree.
const MAJOR = ['refrigerators', 'washers-dryers', 'dishwashers', 'ranges-ovens', 'microwaves-hoods'];
export const MARKET_CATEGORIES = COLLECTIONS.filter((c) => MAJOR.includes(c.slug)).flatMap((c) => c.cats);

// The existing four labels and no fifth. "Used" is not a choice: a pre-owned unit is
// Refurbished (owner, 2026-10-08), and the retired labels stay retired.
export const LISTING_CONDITIONS = INTAKE_CONDITIONS;
export const isRefurbished = (c) => c === 'Refurbished';
export const isNewCondition = (c) => /^New\b/.test(c || '');

export const LANES = {
  A: 'Fulfilled by Bargain Bay — the unit comes to our warehouse',
  B: 'Vendor-held — we collect it from the vendor and deliver',
  C: 'Vendor ships it themselves'
};

// What each trust tier may do. Probation is Lane A only and capped; self-shipping
// is Standard and above (owner, 2026-10-08).
export const TIER_LIMITS = {
  0: { lanes: ['A'], maxUnits: 10 },
  1: { lanes: ['A', 'B', 'C'], maxUnits: 50 },
  2: { lanes: ['A', 'B', 'C'], maxUnits: 200 }
};

export const LISTING_STATUSES = [
  'draft', 'in_review', 'changes_requested', 'approved', 'awaiting_checkin', 'live',
  'paused', 'reserved', 'sold', 'rejected', 'withdrawn'
];
// Counted against the tier cap, and the serial may not appear twice among them.
export const OCCUPYING_STATUSES = ['in_review', 'approved', 'awaiting_checkin', 'live', 'reserved', 'paused'];
export const EDITABLE_STATUSES = ['draft', 'changes_requested'];

// A fixed list, so rejections stay countable (same reason as LEAD_SOURCES).
export const REJECT_REASONS = {
  photos_insufficient: 'Photos are not sufficient',
  photos_not_actual_unit: 'Photos are not of the actual unit',
  plate_mismatch: 'Model does not match the rating plate',
  condition_overstated: 'Condition is overstated',
  missing_defect_disclosure: 'A defect is not disclosed',
  prohibited_item: 'Prohibited item',
  pricing_unverifiable: 'The retail / compare-at price cannot be verified',
  contact_info_in_text: 'Text contains contact details or sends buyers off the platform',
  duplicate_serial: 'This serial number is already listed',
  other: 'Other (explained)'
};

export const PHOTO_ROLES = ['front', 'back', 'interior', 'controls', 'defect', 'accessories', 'other', 'plate'];
// `plate` is the rating plate: private evidence, never shown to a customer.
export const isEvidenceRole = (r) => r === 'plate';
export const MAX_PUBLIC_PHOTOS = 20;

/** What the gallery needs, by condition. */
export function photoRequirements(condition) {
  const isNew = condition === 'New in Box';
  const needsDefect = /Scratch & Dent/.test(condition || '');
  return {
    minPublic: isNew ? 4 : 6,
    roles: isNew ? ['front'] : ['front', 'back', 'interior', 'controls'].concat(needsDefect ? ['defect'] : []),
    evidence: ['plate']
  };
}

/** What is still missing from a photo set. `photos` = [{ role, kind }]. */
export function photoProblems(photos, condition) {
  const req = photoRequirements(condition);
  const pub = photos.filter((p) => p.kind !== 'evidence');
  const roles = new Set(photos.map((p) => p.role));
  const out = [];
  if (pub.length < req.minPublic) out.push({ field: 'photos', text: `Add at least ${req.minPublic} photos of the actual unit (you have ${pub.length}).` });
  for (const r of req.roles) if (!roles.has(r)) out.push({ field: 'photos', text: `Missing a "${r}" photo.` });
  if (!roles.has('plate')) out.push({ field: 'photos', text: 'Add a clear photo of the rating plate showing the model and serial number (private — customers never see it).' });
  return out;
}

// --- text -------------------------------------------------------------------

const PHONE = /(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/;
const EMAIL = /[\w.+\-]+@[\w\-]+\.[\w.\-]+/;
const URL_ = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9\-]+\.(?:com|ca|net|org|io|co)\b/i;
const OFF_PLATFORM = /\b(whats\s?app|kijiji|facebook\s+market(?:place)?|fb\s+market(?:place)?|text\s+me|call\s+me|dm\s+me|message\s+me|e-?transfer\s+me|cash\s+only|ask\s+me\s+for\s+a\s+discount)\b/i;
const PROMO = /\b(best|cheap(?:est)?|wow|must\s+see|hurry|limited\s+time|bargain)\b/i;
// A new-in-box claim on a unit being sold as used or refurbished is the one lie that
// ends a vendor outright, so the text is checked for it too.
const NEW_CLAIM = /\b(brand\s+new|never\s+used|unused)\b/i;

/** Contact details or off-platform steering in any free text. */
export function textProblems(text, label = 'Text') {
  const s = String(text || '');
  const out = [];
  if (PHONE.test(s)) out.push({ field: label, text: `${label} contains a phone number. Contact details are not allowed.` });
  if (EMAIL.test(s)) out.push({ field: label, text: `${label} contains an email address.` });
  if (URL_.test(s.replace(EMAIL, ' '))) out.push({ field: label, text: `${label} contains a website or link.` });
  if (OFF_PLATFORM.test(s)) out.push({ field: label, text: `${label} steers buyers off the platform.` });
  return out;
}

export function titleProblems(title) {
  const t = String(title || '').trim();
  const out = [];
  if (t.length < 10) out.push({ field: 'title', text: 'The title is too short. Use: Make Model — type, size, colour.' });
  if (t.length > 120) out.push({ field: 'title', text: 'The title is over 120 characters.' });
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) out.push({ field: 'title', text: 'Do not write the title in capitals.' });
  if (/\p{Extended_Pictographic}/u.test(t)) out.push({ field: 'title', text: 'No emoji in the title.' });
  if (PROMO.test(t)) out.push({ field: 'title', text: 'Leave promotional words out of the title.' });
  if (/\$\s?\d/.test(t)) out.push({ field: 'title', text: 'Do not put a price in the title.' });
  return [...out, ...textProblems(t, 'title')];
}

// --- fields -----------------------------------------------------------------

const clean = (s) => { const v = String(s ?? '').trim(); return v === '' ? null : v; };
const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Only the fields a vendor may set, trimmed and typed. Anything else is dropped. */
export function normalizeFields(i = {}) {
  const out = {};
  const str = (k, to = k) => { if (k in i) out[to] = clean(i[k]); };
  const n = (k) => { if (k in i) out[k] = num(i[k]); };
  ['category', 'make', 'model', 'serial', 'condition', 'title', 'description', 'compareAtSource', 'testNotes',
   'refurbNotes', 'deliveryNotes', 'pickupAddress', 'pickupCity', 'pickupPostal', 'lane', 'testedOn'].forEach((k) => str(k));
  ['price', 'compareAt', 'widthIn', 'depthIn', 'heightIn', 'weightLb', 'warrantyMonths'].forEach(n);
  if ('testedWorking' in i) out.testedWorking = i.testedWorking === true || i.testedWorking === 'true';
  if ('attrs' in i && i.attrs && typeof i.attrs === 'object' && !Array.isArray(i.attrs)) out.attrs = i.attrs;
  if (out.lane) out.lane = String(out.lane).toUpperCase();
  return out;
}

/**
 * Everything wrong with a listing that stops it being submitted. `l` is the
 * normalised listing, `photos` are [{ role, kind }]. Blocking problems only — a
 * human reviews what a rule cannot judge (is the photo of THIS unit, is the grade
 * honest).
 */
export function validateForSubmit(l, photos = []) {
  const p = [];
  const need = (cond, field, text) => { if (cond) p.push({ field, text }); };
  need(!MARKET_CATEGORIES.includes(l.category), 'category', 'Choose a category from the list.');
  need(!l.make, 'make', 'Make is required.');
  need(!l.model, 'model', 'The exact model number is required — type it as it appears on the rating plate.');
  need(!l.serial, 'serial', 'The serial number is required (private; used to stop duplicate and stolen listings).');
  if (!LISTING_CONDITIONS.includes(l.condition)) {
    p.push({ field: 'condition', text: /^used$/i.test(l.condition || '')
      ? 'A pre-owned unit must be listed as Refurbished, not Used.'
      : `Condition must be one of: ${LISTING_CONDITIONS.join(', ')}.` });
  }
  p.push(...titleProblems(l.title));
  need(!l.description || String(l.description).length < 40, 'description', 'Describe the unit and every defect (at least a couple of sentences).');
  p.push(...textProblems(l.description, 'description'));
  p.push(...textProblems(l.deliveryNotes, 'deliveryNotes'));
  p.push(...textProblems(l.testNotes, 'testNotes'));
  p.push(...textProblems(l.refurbNotes, 'refurbNotes'));
  need(!(l.price > 0), 'price', 'Enter a price (CAD, before tax).');
  if (l.compareAt != null) {
    need(l.compareAt <= l.price, 'compareAt', 'The retail price must be higher than your price.');
    need(!l.compareAtSource, 'compareAtSource', 'Say where the retail price comes from (a manufacturer or retailer link, or an invoice) — otherwise leave it blank.');
  }
  for (const [k, label] of [['widthIn', 'Width'], ['depthIn', 'Depth'], ['heightIn', 'Height'], ['weightLb', 'Weight']]) {
    need(!(l[k] > 0), k, `${label} is required — our crew is staffed against it.`);
  }
  need(!warrantyOk(l.warrantyMonths), 'warrantyMonths', `Every unit carries at least ${WARRANTY_MONTHS} months of warranty from the vendor.`);
  need(!['A', 'B', 'C'].includes(l.lane), 'lane', 'Choose how the unit will be fulfilled.');
  if (l.lane === 'B') need(!l.pickupAddress || !l.pickupPostal, 'pickupAddress', 'Lane B needs the pickup address and postal code.');
  need(l.testedWorking !== true, 'testedWorking', 'Confirm the unit was tested and is working.');
  need(!l.testNotes, 'testNotes', 'Say how it was tested (power-on, full cycle, cooled to temperature…).');
  if (isRefurbished(l.condition)) {
    need(!l.refurbNotes, 'refurbNotes', 'A Refurbished unit needs a note on what was done to it: cleaned, repaired, parts replaced.');
  }
  // A unit sold as used/refurbished must not be described as new.
  if (!isNewCondition(l.condition) && NEW_CLAIM.test(`${l.title || ''} ${l.description || ''}`)) {
    p.push({ field: 'description', text: 'This is not a new unit, so it cannot be described as brand new or unused.' });
  }
  p.push(...photoProblems(photos, l.condition));
  return p;
}

/** The limits for a vendor's tier — what they may list, where, and how many. */
export function tierProblem(tier, lane, occupied) {
  const lim = TIER_LIMITS[tier] || TIER_LIMITS[0];
  if (!lim.lanes.includes(lane)) {
    return lane === 'C'
      ? 'Shipping units yourself opens at Standard tier. Use Lane A until then.'
      : `Your tier can list in Lane ${lim.lanes.join('/')} only.`;
  }
  if (occupied >= lim.maxUnits) return `Your tier is limited to ${lim.maxUnits} listings in review or for sale at once.`;
  return null;
}

// --- picture matching (pure, so the server and the tests share it) -----------
/** Number of differing bits between two 64-bit hex hashes. Pure. */
export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
/** Close enough to be the same picture (re-saved, resized, lightly edited). */
export const SAME_PICTURE_BITS = 6;
export const isSamePicture = (a, b) => hammingDistance(a, b) <= SAME_PICTURE_BITS;

