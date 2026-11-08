// Installation and haul-away as ADD-ONS to an online order. PURE — no imports — because
// the checkout page previews them in the browser and /api/checkout prices them again
// on the server from scratch (the browser's figure is never used).
//
// The prices are the "RS Solutions Delivery Rate Sheet 2026" (Appliance Installations,
// and Haul Away at $20 per item). The service price catalog (/admin/sales-services) is
// where the owner changes one or switches one off: `priceOverrides` carries that in, and
// a service that is not in the catalog at all simply keeps the rate-sheet price.
//
// Rules, from the rate sheet's own scope of work:
//   · Delivery orders only. An install or a haul-away happens at the door, so a pickup
//     order is offered neither.
//   · OUR units only. A marketplace seller's unit and a Vesta unit are not ours to install.
//   · Each add-on belongs to one unit and only to a kind of appliance it is defined for
//     (a dishwasher install is not offered on a fridge). Haul-away is "same type as the
//     appliance being delivered", which is exactly what a per-unit add-on is.
//   · Two options in one GROUP are alternatives (existing waterline OR a new one;
//     a plain laundry install OR a stacking/pedestal one), never both.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// `name` is the service's name in the price catalog AND what the customer sees on the
// invoice. Every installation says "install" and the haul-away says "haul-away": dispatch
// reads those words off the order to tag the stop (isInstallLine / isHaulAwayLine).
export const ADDONS = [
  { key: 'haul_away', name: 'Haul-away', label: 'Haul away your old one', price: 20, cats: ['Refrigerator', 'Freezer', 'Beverage Center', 'Wine Cooler', 'Washer', 'Dryer', 'Laundry Center', 'Washer/Dryer Combo', 'Dishwasher', 'Range', 'Wall Oven', 'Cooktop', 'Microwave', 'Range Hood'],
    note: 'Per appliance. It must be the same type as the one we deliver, disconnected and emptied.', cost: 0, costBasis: 'unit' },
  { key: 'laundry_install', name: 'Laundry installation', label: 'Laundry installation', price: 40, cats: ['Washer', 'Dryer', 'Washer/Dryer Combo'], group: 'laundry',
    note: 'No gas. You provide the hoses.' },
  { key: 'laundry_stack', name: 'Stacking or pedestal laundry installation', label: 'Stacking or pedestal installation', price: 75, cats: ['Washer', 'Dryer', 'Laundry Center', 'Washer/Dryer Combo', 'Laundry Pedestal'], group: 'laundry',
    note: 'Per stack or pedestal set — add it to one of the pair.' },
  { key: 'dishwasher_install', name: 'Dishwasher installation (basic, uninstall + install)', label: 'Dishwasher installation', price: 120, cats: ['Dishwasher'],
    note: 'Replaces the old unit in the same place on your existing water, drain and power.' },
  { key: 'wall_oven_install', name: 'Electric wall oven installation (uninstall + install)', label: 'Wall oven installation', price: 175, cats: ['Wall Oven'] },
  { key: 'fridge_waterline_existing', name: 'Fridge waterline installation (connect existing)', label: 'Connect existing waterline', price: 25, cats: ['Refrigerator'], group: 'waterline' },
  { key: 'fridge_waterline_new', name: 'Fridge waterline installation (new, up to 20 ft)', label: 'New waterline (up to 20 ft)', price: 150, cats: ['Refrigerator'], group: 'waterline',
    note: 'Open area only; closed walls or cabinets are quoted separately.' },
  { key: 'gas_install', name: 'Gas dryer or range installation (existing hookup)', label: 'Gas hookup installation', price: 250, cats: ['Dryer', 'Range'],
    note: 'Connects to your existing gas line. New gas lines are not included.' },
  { key: 'otr_install', name: 'OTR microwave or vented range hood installation (uninstall + install)', label: 'Over-the-range installation', price: 125, cats: ['Microwave', 'Range Hood'] }
];
export const ADDON_BY_KEY = Object.fromEntries(ADDONS.map((a) => [a.key, a]));

/** Is this unit one of OURS (not a marketplace seller's, not Vesta's)? */
export const isOwnUnit = (u) => !!u && !u.marketplace && !/^(VS|MP)-/i.test(String(u.id || u.sku || ''));

/** The effective price of an add-on, or null when the owner has switched it off. */
export function addonPrice(addon, priceOverrides = {}) {
  const o = priceOverrides[addon.name];
  if (!o) return addon.price;
  if (o.active === false) return null;
  return o.price == null ? addon.price : round2(o.price);
}

/** Add-ons offered for ONE unit, with their effective price. */
export function addonsFor(unit, { deliveryMethod = 'delivery', priceOverrides = {} } = {}) {
  if (deliveryMethod !== 'delivery' || !isOwnUnit(unit)) return [];
  return ADDONS
    .filter((a) => a.cats.includes(unit.category))
    .map((a) => ({ ...a, price: addonPrice(a, priceOverrides) }))
    .filter((a) => a.price != null);
}

/**
 * Price a selection AUTHORITATIVELY.
 * @param {Array<{sku:string,key:string}>|object} selection  `[{sku,key}]`, or `{ [sku]: [key,...] }`
 * @param {Array<object>} items  the cart's units (id, category, title, make, model, marketplace)
 * Anything that does not hold (unknown add-on, unit not in the cart, wrong kind of appliance,
 * pickup order, two alternatives from one group) is DROPPED and reported — never charged.
 */
export function priceAddons(selection, items, { deliveryMethod = 'delivery', priceOverrides = {} } = {}) {
  const pairs = Array.isArray(selection)
    ? selection
    : Object.entries(selection || {}).flatMap(([sku, keys]) => (Array.isArray(keys) ? keys : []).map((key) => ({ sku, key })));
  const bySku = new Map((items || []).map((u) => [String(u.id), u]));
  const lines = []; const dropped = [];
  const seen = new Set(); const groups = new Set();
  for (const p of pairs) {
    const sku = String(p?.sku || ''); const key = String(p?.key || '');
    const unit = bySku.get(sku);
    const offered = unit ? addonsFor(unit, { deliveryMethod, priceOverrides }).find((a) => a.key === key) : null;
    const dup = seen.has(`${sku}|${key}`);
    const group = offered?.group ? `${sku}|${offered.group}` : null;
    if (!offered || dup || (group && groups.has(group))) { dropped.push({ sku, key }); continue; }
    seen.add(`${sku}|${key}`); if (group) groups.add(group);
    const title = unit.title || `${unit.make || ''} ${unit.model || ''}`.trim() || sku;
    lines.push({ sku, key, description: `${offered.name} — ${title} (${sku})`, amount: offered.price, kind: 'service' });
  }
  return { lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)), dropped };
}

/** What `/admin/sales-services` should hold for these, as starter rows. One definition: the rate sheet. */
export function starterRowsFromAddons() {
  return ADDONS.map((a) => ({
    name: a.name, side: 'both', pricingType: 'fixed', defaultPrice: a.price, internalCost: a.cost ?? null, costBasis: a.costBasis || 'appliance',
    bookable: true, description: [a.label, a.note].filter(Boolean).join('. ')
  }));
}
