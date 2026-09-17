// "Is this the same appliance model?" — the one definition, shared by the server
// (reconciling RS Ops against the tracker, matching purchase invoice lines to
// units already booked in, spotting sales typed without a stock unit) and the
// browser (the invoice form). NO IMPORTS: it runs in both places.
//
// Model numbers arrive typed three different ways for one machine: the invoice's
// marketed model (PRFS2883AF), the sticker with its revision suffix (PRFS2883AFG),
// and a rep's typing with a letter O for a zero. Matching has to tolerate exactly
// those and nothing looser — a match here moves money and stock.

export const NEEDS_INVOICE = 'NEEDS INVOICE';

// Upper-case, letters and digits only, O→0 and I→1 folded together.
export function normModel(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/I/g, '1');
}

// Same model: identical once normalised, or one is the other plus a short
// revision suffix (KOES530PWH / KOES530PWH00). The shorter side has to carry
// real length — "WM37" is a prefix of half a catalogue.
export function modelsMatch(a, b) {
  const x = normModel(a), y = normModel(b);
  if (x.length < 5 || y.length < 5) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 7 && long.startsWith(short) && long.length - short.length <= 3;
}

// Model-number-looking tokens in free text: 6+ characters mixing letters and
// digits. "Midea MRF18B4AST fridge" → ['MRF18B4AST']. Postal codes (L1W3T9) are
// 6 characters too, which is why a token only ever counts when it matches a
// model that is actually in stock — never on its own.
export function modelTokens(text) {
  const looksLikeModel = (t) => t.replace(/-/g, '').length >= 6 && /[A-Za-z]/.test(t) && /\d/.test(t);
  const out = [];
  String(text || '')
    // '#' and ':' separate too — reps type "Model#MRF18B4AST" and "Model:MRF18B4AST",
    // and gluing "Model" onto the number made a line match nothing.
    .split(/[\s,;()/\\|#:]+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9-]+$/g, ''))
    .forEach((t) => {
      if (looksLikeModel(t)) out.push(t);
      // A dash is sometimes part of the model (H2265-1E) and sometimes glue between
      // a model and an item number (FRTE1835AS-80025061) or two models of a set
      // (WFW5720RW0-YWED5720RW0). Offer the whole token AND each piece; matching
      // against real stock decides which one means anything.
      if (t.includes('-')) t.split('-').filter(looksLikeModel).forEach((p) => out.push(p));
    });
  return [...new Set(out)];
}

export function textNamesModel(text, model) {
  return modelTokens(text).some((t) => modelsMatch(t, model));
}

export const isSoldStatus = (status) => /^sold$/i.test(String(status || '').trim());

// A tracker row still waiting for the purchase invoice that should have put it there.
export const isWaitingForInvoice = (invoiceCell) =>
  String(invoiceCell || '').trim().toUpperCase().startsWith(NEEDS_INVOICE);

// The supplier's invoice number, when an RS Ops lot was named after it:
// SS-PS-INV117057 → PS-INV117057, SS-LotPS-INV117036 → PS-INV117036,
// SS-117082 → 117082. Only a hint — used to find rows the invoice already put on
// the tracker, never written anywhere as if it were known.
export function invoiceHintFromLot(lotId) {
  const s = String(lotId || '').toUpperCase();
  const named = s.match(/(S-ORD\d{4,}|PS-INV\d{4,}|INV-?\d{4,})/);
  if (named) return named[1];
  const bare = s.match(/^SS-(\d{5,})$/);
  return bare ? bare[1] : '';
}

// RS Ops's category words → the tracker's own (the Category column is what
// the storefront groups by, so it has to stay in the tracker's vocabulary).
const CATEGORY_MAP = {
  'range / stove': 'Range', 'range': 'Range', 'stove': 'Range',
  'microwave / otr': 'Microwave', 'microwave': 'Microwave',
  'refrigerator': 'Refrigerator', 'fridge': 'Refrigerator', 'freezer': 'Freezer',
  'washer': 'Washer', 'dryer': 'Dryer', 'dishwasher': 'Dishwasher',
  'wall oven': 'Wall Oven', 'cooktop': 'Cooktop', 'range hood': 'Range Hood',
  'laundry center': 'Laundry Center', 'washer/dryer combo': 'Washer/Dryer Combo'
};
export function trackerCategory(rsopsCategory, invoiceCategory) {
  if (String(invoiceCategory || '').trim()) return String(invoiceCategory).trim();
  const k = String(rsopsCategory || '').trim().toLowerCase();
  return CATEGORY_MAP[k] || (k ? String(rsopsCategory).trim() : 'Other');
}
