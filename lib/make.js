// One definition of "what brand is this unit". No imports: runs on the server
// (inventory read, tracker import) and is safe in the browser.
//
// The tracker's Make column is typed by hand, so the Brand filter filled up with
// descriptions ("LG 27" Frontload Washer- White", "Whirlpool wall oven") and
// spelling variants. A make that STARTS with a known brand collapses to it; anything
// else is only trimmed, never guessed at, so an unfamiliar brand still shows up.
const BRANDS = [
  'Whirlpool', 'Maytag', 'KitchenAid', 'Amana', 'Frigidaire', 'Electrolux', 'GE Profile', 'GE Café', 'GE',
  'Hotpoint', 'Haier', 'LG', 'Samsung', 'Bosch', 'Beko', 'Blomberg', 'Midea', 'Hisense', 'Danby', 'Marathon',
  'Fulgor Milano', 'Bertazzoni', 'Miele', 'Speed Queen', 'Insignia', 'Kenmore', 'Cuisinart', 'Shark', 'Vesta',
  'Thor Kitchen', 'Forno', 'Cosmo', 'Smeg', 'Viking', 'Sub-Zero', 'Jenn-Air', 'Whirlpool', 'Café', 'Fisher & Paykel',
  'Avanti', 'Magic Chef', 'Conserv', 'Summit', 'Equator', 'Panasonic', 'Sharp', 'Toshiba', 'Dyson', 'Breville'
];
// "P&C" and similar: spelling variants the owner has confirmed are one brand.
const ALIASES = { 'p&c': 'P&C', 'ge appliances': 'GE', 'general electric': 'GE', 'cafe': 'Café', 'kitchen aid': 'KitchenAid', 'jennair': 'Jenn-Air', 'jenn air': 'Jenn-Air' };

const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const SORTED = [...new Set(BRANDS)].sort((a, b) => b.length - a.length);

export function normalizeMake(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const f = fold(s);
  if (ALIASES[f]) return ALIASES[f];
  for (const b of SORTED) {
    const bf = fold(b);
    if (f === bf) return b;
    if (f.startsWith(bf) && !/[a-z0-9]/.test(f[bf.length] || ' ')) return b;
  }
  for (const [k, v] of Object.entries(ALIASES)) {
    if (f.startsWith(k) && !/[a-z0-9]/.test(f[k.length] || ' ')) return v;
  }
  return s;
}
