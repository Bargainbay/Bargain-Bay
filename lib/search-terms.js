// Client-safe storefront search matching. Fixes the literal-substring problem
// where "tvs", "fridges", or "washers" returned nothing: every query token now
// matches if ANY of its variants (the word itself, its singular forms, and its
// synonyms) appears in the unit's keyword blob.
const SYN_GROUPS = [
  ['tv', 'television'],
  ['fridge', 'refrigerator'],
  ['freezer', 'deep freeze'],
  ['stove', 'range', 'oven', 'cooker'],
  ['washer', 'washing machine'],
  ['hood', 'range hood', 'vent'],
  ['dish washer', 'dishwasher'],
  ['micro wave', 'microwave'],
  ['ac', 'air conditioner'],
  ['vacuum', 'vac']
];

// "tvs" → ["tvs","tv"], "dishes" → ["dishes","dishe","dish"], "sets" → ["sets","set"]
function singulars(token) {
  const out = [token];
  if (token.length > 3 && token.endsWith('es')) out.push(token.slice(0, -2));
  if (token.length > 2 && token.endsWith('s')) out.push(token.slice(0, -1));
  return out;
}

function variantsFor(token) {
  const vars = new Set(singulars(token));
  for (const base of [...vars]) {
    for (const group of SYN_GROUPS) {
      if (group.includes(base)) group.forEach((g) => vars.add(g));
    }
  }
  return [...vars];
}

// Normalize: unify inch notation, split hyphens/slashes into words ("3-door"
// searches as "3 door", "side-by-side" as "side by side"), lowercase, collapse.
export function normalizeSearch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["”″]/g, ' inch ')
    .replace(/\b(inches|inch|in)\b/g, ' inch ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every token must match via at least one variant. Matching is WORD-PREFIX,
// not free substring: "washer" matches "washers" and a partial model number
// matches its full form, but "washer" does NOT match "dishwasher". Multi-word
// variants ("washing machine") match at a word boundary.
export function matchesQuery(hay, query) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const h = normalizeSearch(hay);
  const words = h.split(' ');
  const joined = ' ' + h;
  const hit = (v) => (v.includes(' ') ? joined.includes(' ' + v) : words.some((w) => w.startsWith(v)));
  return tokens.every((t) => variantsFor(t).some(hit));
}
