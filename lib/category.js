// One definition of what category a unit is in. NO imports: the sync parser, the
// inventory reader and the tests all use it.
//
// Storefront collections match `category` by EXACT string (COLLECTIONS.cats in
// lib/constants.js), so every spelling the tracker, the intake dropdown or a
// supplier invoice can produce has to land on the spelling the collections use.
// "Laundry Centre" (intake's spelling) never matched "Laundry Center", and a unit
// the tracker filed as plain "Appliance" matched nothing at all — a Whirlpool
// WRFF3136SZ fridge was invisible under Fridges for that reason.

// Folded (lower-case, letters and digits only) -> the collection spelling.
const ALIASES = {
  refrigerator: 'Refrigerator', refrigerators: 'Refrigerator', fridge: 'Refrigerator', fridges: 'Refrigerator',
  freezer: 'Freezer', freezers: 'Freezer',
  winecooler: 'Wine Cooler', winefridge: 'Wine Cooler', beveragecenter: 'Beverage Center', beveragecentre: 'Beverage Center',
  beveragecooler: 'Beverage Center',
  washer: 'Washer', washers: 'Washer', washingmachine: 'Washer',
  dryer: 'Dryer', dryers: 'Dryer',
  laundrycenter: 'Laundry Center', laundrycentre: 'Laundry Center', laundrytower: 'Laundry Center',
  washertower: 'Laundry Center', stackedlaundry: 'Laundry Center', laundrystack: 'Laundry Center',
  washerdryercombo: 'Washer/Dryer Combo', washerdryer: 'Washer/Dryer Combo', combowasherdryer: 'Washer/Dryer Combo',
  allinone: 'Washer/Dryer Combo', allinonewasherdryer: 'Washer/Dryer Combo',
  laundrypedestal: 'Laundry Pedestal', pedestal: 'Laundry Pedestal', pedestals: 'Laundry Pedestal',
  airdresser: 'Air Dresser',
  dishwasher: 'Dishwasher', dishwashers: 'Dishwasher',
  range: 'Range', ranges: 'Range', stove: 'Range', stoves: 'Range',
  walloven: 'Wall Oven', ovens: 'Wall Oven', oven: 'Wall Oven',
  cooktop: 'Cooktop', cooktops: 'Cooktop', rangetop: 'Cooktop',
  warmingdrawer: 'Warming Drawer',
  microwave: 'Microwave', microwaves: 'Microwave',
  rangehood: 'Range Hood', hood: 'Range Hood', hoods: 'Range Hood',
  rangehoodaccessories: 'Range Hood Accessories',
  massagechair: 'Massage Chair',
  television: 'Television', tv: 'Television', tvs: 'Television',
  vacuum: 'Vacuum', carpetcleaner: 'Vacuum', steamcleaner: 'Vacuum',
  smallappliance: 'Small Appliance', airconditioner: 'Air Conditioner', dehumidifier: 'Dehumidifier',
  airpurifier: 'Air Purifier', waterdispenser: 'Water Dispenser'
};

// Words the tracker uses when it has not said what the thing is.
const VAGUE = new Set(['', 'appliance', 'appliances', 'other', 'misc', 'miscellaneous', 'unknown', 'general', 'na']);

const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Title words, most specific first: a "washer dryer combo" must not be read as a
// washer, a "pedestal" is not a fridge, a "range hood" is not a range.
const TITLE_RULES = [
  [/laundry\s+(center|centre|tower)|washtower|wash\s*tower|stacked\s+(washer|laundry)|washer\s*(\/|&|and)?\s*dryer\s+(stack|tower)/i, 'Laundry Center'],
  [/(all[\s-]*in[\s-]*one|combo).*(washer|dryer)|washer\s*(\/|&|and)?\s*dryer\s*combo|washer-dryer/i, 'Washer/Dryer Combo'],
  [/pedestal/i, 'Laundry Pedestal'],
  [/air\s*dresser|styler/i, 'Air Dresser'],
  [/wine\s*(cooler|fridge|refrigerator|cellar)/i, 'Wine Cooler'],
  [/beverage\s*(center|centre|cooler)/i, 'Beverage Center'],
  [/range\s*hood|hood\b/i, 'Range Hood'],
  [/dishwasher/i, 'Dishwasher'],
  [/\b(freezer)\b/i, 'Freezer'],
  [/refrigerator|\bfridge|french[\s-]*door|side[\s-]*by[\s-]*side|bottom[\s-]*freezer|top[\s-]*freezer|counter[\s-]*depth/i, 'Refrigerator'],
  [/\bwasher\b|front[\s-]*load|top[\s-]*load/i, 'Washer'],
  [/\bdryer\b/i, 'Dryer'],
  [/wall\s*oven|built[\s-]*in\s*oven|double\s*oven/i, 'Wall Oven'],
  [/cooktop|rangetop/i, 'Cooktop'],
  [/warming\s*drawer/i, 'Warming Drawer'],
  [/microwave/i, 'Microwave'],
  [/\b(range|stove|slide[\s-]*in|freestanding\s+(gas|electric))\b/i, 'Range'],
  [/massage\s*chair/i, 'Massage Chair'],
  [/vacuum|carpet\s*cleaner/i, 'Vacuum']
];

// A fixed spelling -> its collection spelling, or null if it is not one we know.
export function aliasCategory(raw) {
  return ALIASES[fold(raw)] || null;
}

export function isVagueCategory(raw) {
  return VAGUE.has(fold(raw));
}

// Parts and add-ons name the appliance they fit; they are not that appliance.
const ACCESSORY = /\b(kit|filter|gasket|shelf|bracket|trim|duct|cover|accessor(y|ies)|replacement|part|hose|cable|adapter)\b/i;

// Model-number families that are unambiguous on their own, for a unit whose
// title names no appliance at all. Deliberately short: a wrong guess files a
// machine under the wrong collection, which is worse than "Appliance".
const MODEL_FAMILIES = [
  [/^(WR[FSBXT]|MF[IDTX]|MR[FTBS]|MS[FSB]|ABB|ASD)\w*\d/i, 'Refrigerator'], // Whirlpool / Maytag / Amana fridges
  [/^LF\d/i, 'Refrigerator']                                                 // LG LF-series fridges
];

export function categoryFromModel(model) {
  const m = String(model ?? '').replace(/[^A-Za-z0-9]/g, '');
  for (const [re, cat] of MODEL_FAMILIES) if (re.test(m)) return cat;
  return null;
}

export function categoryFromTitle(title) {
  const t = String(title ?? '');
  if (ACCESSORY.test(t)) return null;
  for (const [re, cat] of TITLE_RULES) if (re.test(t)) return cat;
  return null;
}

// One unit on its own. Never invents a category the evidence does not support:
// a vague value that nothing in the title explains is left as it was.
export function canonicalCategory(raw, { title, model } = {}) {
  const alias = aliasCategory(raw);
  if (alias) return alias;
  if (isVagueCategory(raw)) {
    if (ACCESSORY.test(String(title ?? ''))) return raw ?? '';
    return categoryFromTitle(title) || categoryFromModel(model) || (raw ?? '');
  }
  return raw;
}

const modelKey = (u) => fold(u.model);

// A whole list: each unit alone first, then a still-vague one borrows the answer
// from other units of the SAME model number when they agree on one category.
// "LG LF21C6200S" has no appliance word in its title, but another LF21C6200S does.
export function canonicalizeUnits(units) {
  const out = units.map((u) => {
    const category = canonicalCategory(u.category, u);
    return category === u.category ? u : { ...u, category };
  });
  const byModel = new Map();
  for (const u of out) {
    if (isVagueCategory(u.category) || !modelKey(u)) continue;
    const set = byModel.get(modelKey(u)) || new Set();
    set.add(u.category);
    byModel.set(modelKey(u), set);
  }
  return out.map((u) => {
    if (!isVagueCategory(u.category) || !modelKey(u)) return u;
    const set = byModel.get(modelKey(u));
    return set && set.size === 1 ? { ...u, category: [...set][0] } : u;
  });
}
