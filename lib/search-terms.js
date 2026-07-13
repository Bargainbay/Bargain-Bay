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
  ['vacuum', 'vac'],
  ['laundry', 'washer', 'dryer']
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

// Normalize a raw query: unify inch notation, lowercase, collapse whitespace.
export function normalizeSearch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["”″]/g, ' inch ')
    .replace(/\b(inches|inch|in)\b/g, ' inch ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every token must match via at least one variant. The haystack gets the same
// inch normalization as the query, so `55"` in a title matches "55 inch".
export function matchesQuery(hay, query) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const h = normalizeSearch(hay);
  return tokens.every((t) => variantsFor(t).some((v) => h.includes(v)));
}
