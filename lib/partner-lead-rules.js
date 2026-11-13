// What a partner's lead generator sends, and what they are told happened. NO IMPORTS: the browser form uses it too.

export const HOW_REACHED = [
  ['message', 'Messaged me'],
  ['text', 'Texted me'],
  ['call', 'Called me'],
  ['in_person', 'Spoke in person'],
  ['other', 'Other']
];

// [key, label, side, interest tag]. The generator picks one plain answer; the tracker gets the tag and the side.
export const WANTS = [
  ['appliance', 'Buy an appliance', 'bb', 'appliance_purchase'],
  ['delivery', 'Delivery / moving', 'rs', 'delivery'],
  ['installation', 'Installation', 'both', 'installation'],
  ['repair', 'Repair', 'rs', 'repair'],
  ['other', 'Something else', 'both', null]
];
export const wantFor = (key) => WANTS.find((w) => w[0] === key) || null;
export const wantLabelFor = (tags = []) => {
  const w = WANTS.find((x) => x[3] && tags.includes(x[3]));
  return w ? w[1] : 'Enquiry';
};

// The plain status a generator sees. Derived from facts, never typed by anybody (and never from an internal note).
export const STATUS = {
  sent: 'Sent',
  with_team: 'With our team',
  called: 'Called',
  talking: 'In conversation',
  quote: 'Quote sent',
  sold: 'Sold',
  completed: 'Completed',
  not_interested: 'Not interested',
  couldnt_reach: "Couldn't reach",
  wrong_number: 'Wrong number',
  not_counted: 'Not counted'
};
export const SUCCESS = ['sold', 'completed'];

/**
 * lead: { stage, lost_reason, claimed (a rep owns it), first_touch_at, sold, delivered }.
 * `sold` / `delivered` come from a real counted order for the customer the lead became — never from a stage somebody moved.
 */
export function partnerStatus(l) {
  if (l.delivered) return 'completed';
  if (l.sold || l.stage === 'won') return 'sold';
  if (l.stage === 'lost') {
    if (l.lost_reason === 'junk') return 'not_counted';
    if (l.lost_reason === 'wrong_number') return 'wrong_number';
    if (l.lost_reason === 'no_response') return 'couldnt_reach';
    return 'not_interested';
  }
  if (l.stage === 'proposal') return 'quote';
  if (l.stage === 'conversation' || l.stage === 'meeting') return 'talking';
  if (l.stage === 'contacted' || l.first_touch_at) return 'called';
  if (l.claimed) return 'with_team';
  return 'sent';
}

/** A North American number: 10 digits (or 11 with a leading 1), area code and exchange not starting 0 or 1. */
export function validPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return false;
  if (!/[2-9]/.test(d[0]) || !/[2-9]/.test(d[3])) return false;
  if (/^(\d)\1{9}$/.test(d)) return false;               // 5555555555
  return true;
}
export const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(e || '').trim());

export const DUP_OTHER = 'This lead was already entered by someone else, so it cannot be counted again.';

// Ceilings so one login cannot pour junk in or run up a bill.
export const LEADS_PER_10_MIN = 10;
export const LEADS_PER_DAY = 40;

// A lead has this long to become its sender's customer. After that a purchase is no longer credited to the lead.
export const LEAD_CREDIT_DAYS = 90;
