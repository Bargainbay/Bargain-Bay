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
  // "PRFS2883AFG/H" is a rep writing two colour variants at once: AFG or AFH.
  // Splitting on the slash only ever offered the first, so the AFH fridge that
  // line sold could not be found. The ending after a slash (≤3 characters)
  // replaces the same number of characters at the end of the model before it.
  for (const m of String(text || '').matchAll(/([A-Za-z0-9-]{6,})\/([A-Za-z0-9]{1,3})(?![A-Za-z0-9])/g)) {
    const alt = m[1].slice(0, -m[2].length) + m[2];
    if (looksLikeModel(alt)) out.push(alt);
  }
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

// ── One typed line that sold several appliances ──────────────────────────────
// "2x Frigidaire … PRFS2883AFG/H" is ONE invoice line for two fridges, and a line
// carries one SKU. Linking it to its units splits it into one line per unit, and
// the money has to add back to the line to the cent — the invoice total, the HST
// and the order must not move. Here (no imports) so the Stock gaps screen shows
// exactly the figures the server will write.

// n parts of `total`, in whole cents, that add back to it exactly. Every part is
// the same except the LAST, which carries the leftover cent(s): $100 in three is
// 33.33 + 33.33 + 33.34.
export function splitAmount(total, n) {
  const count = Math.max(1, Math.floor(Number(n) || 1));
  const cents = Math.round((Number(total) || 0) * 100);
  const each = Math.trunc(cents / count);
  const parts = Array.from({ length: count }, () => each);
  parts[count - 1] = cents - each * (count - 1);
  return parts.map((c) => c / 100);
}

// What a line says about how many it sold, for a HINT only — "2x …", "x2",
// "qty 2", "6 sets". Never used to cap or decide a count: a washer/dryer "set" is
// two units, and a typed quantity is exactly the kind of thing that is wrong.
// Returns the phrase as typed ("2x", "6 sets") or ''.
export function quantityHint(description) {
  const s = String(description || '');
  const m = s.match(/^\s*(\d{1,2})\s*[x×]\s/i)
    || s.match(/(?:^|[\s(])[x×]\s?(\d{1,2})\b/i)
    || s.match(/\bqty\.?:?\s*(\d{1,2})\b/i)
    || s.match(/\b(\d{1,2})\s*(?:sets?|units|pcs|pieces|pairs?)\b/i);
  return m && Number(m[1]) > 1 ? m[0].trim().replace(/^\(/, '') : '';
}

// A split line is ONE appliance, so a leading "2x " no longer describes it.
// Anything else in the text stays exactly as the rep typed it.
export function singleUnitDescription(description) {
  const s = String(description || '');
  const stripped = s.replace(/^\s*\d{1,2}\s*[x×]\s+/i, '');
  return stripped.trim() ? stripped : s;
}

// ── Finding a unit the way a rep asks for it ─────────────────────────────────
// Every stock picker used to require each typed word to appear, character for
// character, in the unit's text. The tracker says "Range" and "Refrigerator";
// the floor says "stove" and "fridge"; so "LG stove" found nothing while "LG
// range" found eighteen, and INV-1236 (2026-09-21) typed five appliances in
// after "Not from our stock?" became the way past a search that kept coming back
// empty. This reads a query the way it is spoken:
//   * appliance words have synonyms (stove → range, fridge → refrigerator) and
//     match at the START of a word, so "washer" no longer finds dishwashers;
//   * two different appliance words are EITHER-OR — "washer dryer set" is two
//     units, and neither one is both;
//   * a size ("24\"", "30 in") must agree with a size the unit states, and a
//     unit that states none is kept but ranked lower;
//   * a model number matches with the O/0 and revision-suffix tolerance above;
//   * filler ("set", "2x", "inch", "with") is dropped;
//   * a word NOTHING in stock contains is set aside and REPORTED, rather than
//     emptying the list — "Frenchdoor" or a mistyped model number would
//     otherwise hide every right answer. The caller shows what was ignored.
const APPLIANCE_TYPES = [
  { key: 'refrigerator', words: ['fridge', 'fridges', 'refrigerator', 'refrigerators', 'refridgerator', 'frig', 'frige'], find: ['refrigerator', 'fridge', 'refrig'] },
  { key: 'freezer', words: ['freezer', 'freezers', 'chest'], find: ['freezer'] },
  { key: 'range', words: ['range', 'ranges', 'stove', 'stoves', 'cooker'], find: ['range', 'stove'] },
  { key: 'oven', words: ['oven', 'ovens'], find: ['oven', 'range'] },
  { key: 'cooktop', words: ['cooktop', 'cooktops', 'stovetop', 'hob'], find: ['cooktop', 'cook top', 'stovetop'] },
  { key: 'dishwasher', words: ['dishwasher', 'dishwashers', 'dw'], find: ['dishwasher'] },
  { key: 'washer', words: ['washer', 'washers', 'washing'], find: ['washer', 'washing'] },
  { key: 'dryer', words: ['dryer', 'dryers', 'drier'], find: ['dryer'] },
  { key: 'microwave', words: ['microwave', 'microwaves', 'otr', 'mwo'], find: ['microwave', 'otr'] },
  { key: 'hood', words: ['hood', 'hoods', 'hoodfan'], find: ['hood'] }
];
const TYPE_BY_WORD = new Map(APPLIANCE_TYPES.flatMap((t) => t.words.map((w) => [w, t])));
const FILLER = new Set(['set', 'sets', 'pair', 'pairs', 'and', 'with', 'the', 'a', 'an', 'of', 'for', 'unit', 'units',
  'inch', 'inches', 'in', 'cu', 'ft', 'cuft', 'machine', 'appliance', 'new', 'used', 'model', 'sku', '&', '+', 'x']);

// A size is a two-digit width followed by an inch mark or word.
const SIZE_IN_TEXT = /(?:^|[^\d.])(\d{2})\s*(?:"|”|″|''|-?\s*inch|in\b)/gi;
export function sizesIn(text) {
  return [...new Set([...String(text || '').matchAll(SIZE_IN_TEXT)].map((m) => m[1]))];
}

const startsWord = (hay, word) => new RegExp(`(?:^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay);

// Query → { types, sizes, words, models }.
export function parseStockQuery(q) {
  const raw = String(q || '');
  const sizes = sizesIn(raw);
  const cleaned = raw.toLowerCase()
    .replace(/(\d{2})\s*(?:"|”|″|''|-?\s*inch(?:es)?|in\b)/g, '$1 ') // 24" → 24
    .replace(/[“”″"'’]/g, ' ');
  const types = [], words = [], models = [];
  for (const tok of cleaned.split(/[\s,;:/()|#-]+/).filter(Boolean)) {
    const t = tok.replace(/^[^a-z0-9]+|[^a-z0-9.]+$/g, '');
    if (!t || FILLER.has(t) || /^\d{1,2}x$/.test(t) || /^x\d{1,2}$/.test(t)) continue;
    const type = TYPE_BY_WORD.get(t);
    if (type) { if (!types.includes(type)) types.push(type); continue; }
    if (/^\d{2}$/.test(t)) { if (!sizes.includes(t)) sizes.push(t); continue; }
    if (t.length >= 5 && /[a-z]/.test(t) && /\d/.test(t)) { models.push(t); continue; }
    words.push(t);
  }
  return { types, sizes, words, models };
}

// A unit is { id, description, model, status, search } — the shape every picker
// already builds. `search` is the lower-cased text to look in.
function wordHit(u, w) { return u.search.includes(w); }
function modelHit(u, m) {
  if (u.model && modelsMatch(m, u.model)) return true;
  if (u.search.includes(m)) return true;
  const n = normModel(m);
  return n.length >= 5 && normModel(u.search).includes(n);
}
// "Over-the-Range Microwave" and "Range Hood" say range without being one, so a
// microwave or hood only answers a query that asked for a microwave or hood.
const ACCESSORY = ['microwave', 'hood'];
function typeHit(u, types) {
  const asked = new Set(types.map((t) => t.key));
  if (ACCESSORY.some((k) => !asked.has(k) && startsWord(u.search, k))) return false;
  return types.some((t) => t.find.some((f) => startsWord(u.search, f)));
}
function sizeFit(u, sizes) {
  if (!sizes.length) return 1;
  const has = sizesIn(u.search).concat(sizesIn(u.description));
  if (!has.length) return 0.5;          // says no size — kept, ranked lower
  return sizes.some((s) => has.includes(s)) ? 1 : 0;
}

// → { units, ignored: [words set aside because nothing in stock has them],
//     parsed }. `exclude` is a Set of ids already on the document.
export function searchStockUnits(stock, q, { exclude = null, limit = 8 } = {}) {
  const list = (stock || []).filter((u) => u && u.search && !(exclude && exclude.has(u.id)));
  const parsed = parseStockQuery(q);
  const { types, sizes } = parsed;
  if (String(q || '').trim().length < 2) return { units: [], ignored: [], parsed };
  const ignored = [];
  const words = parsed.words.filter((w) => (list.some((u) => wordHit(u, w)) ? true : (ignored.push(w), false)));
  const models = parsed.models.filter((m) => (list.some((u) => modelHit(u, m)) ? true : (ignored.push(m.toUpperCase()), false)));
  if (!types.length && !sizes.length && !words.length && !models.length) return { units: [], ignored, parsed };

  const scored = [];
  list.forEach((u, i) => {
    if (!words.every((w) => wordHit(u, w))) return;
    if (!models.every((m) => modelHit(u, m))) return;
    if (types.length && !typeHit(u, types)) return;
    const fit = sizeFit(u, sizes);
    if (!fit) return;
    let score = fit * 2 + (models.length ? 10 : 0);
    if (/^tested working$/i.test(String(u.status || ''))) score += 0.5;
    scored.push({ u, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return { units: scored.slice(0, limit).map((s) => s.u), ignored, parsed };
}

// ── Why a line is allowed to not come from stock ─────────────────────────────
// It used to be a free-text box, and the first answer typed into it at volume
// was "Already delivered" — five appliances on one invoice. A unit that has gone
// out is still OURS; picking it is the thing that marks it sold. So the reason
// is picked from what can actually be true, and "Other" has to say something.
export const OFF_STOCK_REASONS = [
  'Special order — bought in for this customer, never in our warehouse',
  'Drop-shipped to the customer by the supplier'
];
export const OFF_STOCK_OTHER = 'Other: ';
const GONE_WORDS = /\b(deliver|delivered|delivery|sold|gone|left|picked\s*up|pickup|already|shipped out|went out|out the door)\b/i;

// '' when the reason is acceptable; otherwise what to tell the rep.
export function offStockReasonProblem(reason) {
  const r = String(reason || '').trim();
  if (!r) return 'Say why it isn’t from our stock.';
  if (OFF_STOCK_REASONS.includes(r)) return '';
  if (!r.startsWith(OFF_STOCK_OTHER.trim())) return 'Pick one of the reasons listed.';
  const detail = r.slice(OFF_STOCK_OTHER.trim().length).trim();
  if (detail.length < 8) return 'Say a bit more about why it isn’t from our stock.';
  if (GONE_WORDS.test(detail)) {
    return 'A unit that has already gone out is still ours — find it in stock and pick it (sold-but-not-marked units are still listed). Picking it is what marks it sold. If it really isn’t on the tracker, use “Not on the tracker? Book it in”.';
  }
  return '';
}
