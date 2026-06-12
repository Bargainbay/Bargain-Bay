// Listing content helpers: title parsing (specs table), condition explainers,
// lead sentences and SEO descriptions. Pure functions, safe everywhere.

// One short, honest paragraph per condition tier.
export const CONDITION_COPY = {
  'New in Box':
    'This unit is brand new and unused, still in its original factory packaging. Our technicians verify every unit before it ships, and like everything at Bargain Bay it’s backed by our one-year warranty on top of any remaining manufacturer coverage.',
  'New Open Box':
    'This unit is new and never used — the box was opened (a floor model, repackaged unit, or customer return). Our technicians have bench-tested it and confirmed full functionality, and it’s backed by our one-year warranty. Full performance, big savings.',
  'Scratch & Dent':
    'This unit is fully functional with a cosmetic blemish — typically a scratch or dent, often on a side or back panel that hides against a wall or cabinet. Our technicians have bench-tested it and confirmed performance is not affected, and it’s backed by our one-year warranty.',
  'Refurbished':
    'This unit has been professionally inspected, repaired where needed, and bench-tested back to full working order by our technicians. It carries the same one-year warranty as everything else we sell — restored performance without the new-unit price.',
  'Used':
    'This unit is previously owned. Expect normal signs of use, but no guesswork: our technicians have bench-tested it and confirmed it works as it should, and it’s backed by our one-year warranty — not sold "as-is."',
  'Tested & Working':
    'This unit has been bench-tested by our technicians and confirmed fully functional before listing, and it’s backed by our one-year warranty. Any cosmetic notes are called out in the listing.'
};

export function conditionCopy(condition) {
  return CONDITION_COPY[condition] || CONDITION_COPY['Tested & Working'];
}

const FINISHES = [
  'Monochromatic Stainless',
  'Black Stainless',
  'Stainless Steel',
  'Radiant Silver',
  'Chrome Shadow',
  'Midnight Steel',
  'White',
  'Black'
];

export function parseTitle(title) {
  const t = String(title || '');
  const out = {};
  const w = t.match(/(\d{2})[ -]?(?:Inch|in\b|")/i);
  if (w) out.width = `${w[1]}"`;
  const cap = t.match(/([\d.]+)\s*cu\.?\s*ft/i);
  if (cap) out.capacity = `${cap[1]} cu. ft.`;
  const lower = t.toLowerCase();
  for (const f of FINISHES) {
    if (lower.includes(f.toLowerCase())) { out.finish = f; break; }
  }
  return out;
}

// Rows for the specs table. Rows that don't parse are skipped.
export function specRows(unit) {
  const parsed = parseTitle(unit.title);
  const rows = [
    ['Brand', unit.make],
    ['Model', unit.model],
    ['SKU', unit.id],
    ['Category', unit.category],
    ['Condition', unit.condition],
    ['Width', parsed.width],
    ['Capacity', parsed.capacity],
    ['Finish / Colour', parsed.finish]
  ];
  return rows.filter(([, v]) => v);
}

// Lead sentence: make / category / standout details pulled from the title.
export function leadSentence(unit) {
  const parsed = parseTitle(unit.title);
  const bits = [];
  if (parsed.width) bits.push(parsed.width.replace('"', '-inch'));
  if (parsed.capacity) bits.push(parsed.capacity);
  if (parsed.finish) bits.push(parsed.finish.toLowerCase());
  const detail = bits.length ? ` — ${bits.join(', ')}` : '';
  const cat = String(unit.category || 'appliance').toLowerCase();
  return `The ${unit.make} ${unit.model} is a name-brand ${cat}${detail} — a one-of-a-kind unit at a genuine liquidation price.`;
}

// ~150-char SEO description for product pages + the merchant feed.
export function seoDescription(unit) {
  const price = '$' + Number(unit.price).toLocaleString('en-CA', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return `${unit.make} ${unit.model} ${unit.category} — ${unit.condition}, ${price} CAD. Tested & working, one-year warranty. Hamilton & Scarborough / GTA delivery.`;
}
