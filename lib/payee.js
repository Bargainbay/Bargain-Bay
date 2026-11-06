// Who a bank line is really for, boiled down so that the same payee always gets
// the same key. NO IMPORTS: the categorize workspace in the browser groups with
// exactly the code the server uses, so a group on screen is the group applied.
//
// Why this is needed: a bank descriptor is mostly noise around one useful thing.
//   "MRCH29474100013 MSP"      -> the merchant id changes, MSP is the payee
//   "SEND E-TFR *nMU EXP"      -> *nMU is unique to the transfer, EXP is the memo
//                                 the owner typed, and it is the ONLY signal
//   "Home Depot #7045 TORONTO" -> the store number is noise
// Strip the per-transaction noise and what is left repeats, which is what lets a
// thousand lines collapse into a few dozen payees.

// Words that describe HOW money moved, not WHO it moved to. A match rule built
// from these alone ("send e-tfr") would sweep up every transfer in the account,
// so they never make a rule on their own.
const GENERIC = new Set([
  'send', 'sent', 'receive', 'received', 'e', 'tfr', 'etfr', 'etransfer', 'transfer', 'interac', 'payment', 'pmt',
  'pos', 'purchase', 'debit', 'credit', 'withdrawal', 'deposit', 'pre', 'authorized', 'preauthorized', 'online',
  'bill', 'bank', 'bus', 'stmt', 'tdms', 'mrch', 'msp', 'the', 'and', 'inc', 'ltd', 'corp', 'co', 'canada', 'ca',
  'on', 'to', 'from', 'for', 'of', 'ref', 'no'
]);

/** Lower-case, per-transaction noise removed, words single-spaced. */
export function bankKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\*\S+/g, ' ')              // *nMU, *z27: unique to one transaction
    .replace(/#\s*\d+/g, ' ')            // store #7045
    .replace(/[a-z]*\d{4,}[a-z0-9]*/g, ' ') // MRCH29474100013, long ids and card tails
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')            // stray digits left behind
    .replace(/\s+/g, ' ')
    .trim();
}

/** What to call the payee on screen: what a person typed beats what the bank sent. */
export function payeeLabel(row) {
  return String(row?.payeeOverride || row?.payee || row?.vendor || row?.bankDesc || 'Unknown').trim();
}

/** The grouping key. Rows with the same key are "the same payee". */
export function payeeKey(row) {
  // A name a person typed is the most specific thing there is.
  const typed = bankKey(row?.payeeOverride);
  if (typed) return typed;
  const k = bankKey(row?.payee || row?.vendor || row?.bankDesc);
  return k || 'unknown';
}

/** Words in a key that actually identify somebody. */
export function distinctiveWords(key) {
  return String(key || '').split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
}

/**
 * A stretch of the RAW payee text safe to use as a substring rule: everything
 * before the first store number, reference code or long digit run. Rules match by
 * substring against what the bank sent, so it has to be text that is literally in
 * there ("home depot", from "HOME DEPOT #7045 TORONTO"). Null when what is left
 * identifies nobody (a bare "send e-tfr").
 */
export function rulePrefix(raw) {
  const t = String(raw || '').toLowerCase();
  const cut = t.search(/[*#]|\d{3,}/);
  const left = (cut === -1 ? t : t.slice(0, cut)).replace(/\s+/g, ' ').trim();
  if (left.length < 4) return null;
  return distinctiveWords(bankKey(left)).length ? left : null;
}
