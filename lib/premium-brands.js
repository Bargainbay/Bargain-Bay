// The high-end makes shown on /premium. No imports (the page and the header both use it).
// To add a make, add its name exactly as the tracker spells it; a make with nothing in stock is simply
// not shown, so the list can be generous. Order here is the order of the sections on the page.
export const PREMIUM_BRANDS = [
  'Bertazzoni', 'Fulgor Milano', 'Sub-Zero', 'Wolf', 'Thermador', 'Miele', 'Gaggenau', 'Viking', 'Monogram',
  'JennAir', 'Cafe', 'Smeg', 'Dacor', 'Liebherr', 'Fisher & Paykel', 'Hestan', 'BlueStar', 'La Cornue',
  'Signature Kitchen Suite', 'Cove', 'Forno'
];
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SET = new Map(PREMIUM_BRANDS.map((b, i) => [fold(b), i]));
// "Café" and "Cafe" are one make; so are "Sub Zero" and "Sub-Zero".
export const premiumRank = (make) => (SET.has(fold(make)) ? SET.get(fold(make)) : -1);
export const isPremiumMake = (make) => premiumRank(make) >= 0;
