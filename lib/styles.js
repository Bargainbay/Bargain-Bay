// Subcategory ("type") classifier — SecondShop-style shopping depth derived
// from data we already have: the spec configuration (data/specs.json) plus the
// unit's title. Returns a display label like "French Door" or "Front Load",
// or null when the unit doesn't declare one. Client-safe (no db).

const RULES = {
  Refrigerator: [
    ['french door', 'French Door'],
    ['side-by-side', 'Side-by-Side'], ['side by side', 'Side-by-Side'],
    ['top freezer', 'Top Freezer'], ['top-freezer', 'Top Freezer'],
    ['bottom freezer', 'Bottom Freezer'], ['bottom-freezer', 'Bottom Freezer'],
    ['built-in', 'Built-In'], ['column', 'Built-In'],
    ['mini', 'Compact & Bar'], ['compact', 'Compact & Bar'], ['bar fridge', 'Compact & Bar'],
    ['wine', 'Beverage & Wine'], ['beverage', 'Beverage & Wine']
  ],
  Freezer: [
    ['chest', 'Chest'],
    ['upright', 'Upright'],
    ['column', 'Built-In Column'], ['built-in', 'Built-In Column']
  ],
  Washer: [
    ['front load', 'Front Load'], ['front-load', 'Front Load'],
    ['top load', 'Top Load'], ['top-load', 'Top Load']
  ],
  Dryer: [
    ['heat pump', 'Heat Pump'],
    ['gas', 'Gas'],
    ['electric', 'Electric']
  ],
  Range: [
    ['induction', 'Induction'],
    ['dual fuel', 'Gas & Dual Fuel'], ['gas', 'Gas & Dual Fuel'],
    ['electric', 'Electric']
  ],
  Dishwasher: [
    ['panel-ready', 'Panel Ready'], ['panel ready', 'Panel Ready'],
    ['dishdrawer', 'DishDrawer'],
    ['portable', 'Portable'],
    ['undercounter', 'Built-In'], ['under-counter', 'Built-In'], ['built-in', 'Built-In']
  ],
  Microwave: [
    ['over-the-range', 'Over-the-Range'], ['over the range', 'Over-the-Range'], ['otr', 'Over-the-Range'],
    ['built-in', 'Built-In'],
    ['countertop', 'Countertop'], ['counter-top', 'Countertop']
  ]
};

// TVs shop by screen size, not configuration.
function tvSize(text) {
  const m = text.match(/(\d{2,3})\s*(?:inch|in\b|")/);
  const n = m ? Number(m[1]) : 0;
  if (!n || n < 10 || n > 120) return null;
  if (n >= 65) return '65" & larger';
  if (n >= 50) return '50–64"';
  if (n >= 40) return '40–49"';
  return 'Under 40"';
}

export function styleFor(unit, spec) {
  const text = [spec?.configuration, unit.title, unit.model]
    .filter(Boolean).join(' ').toLowerCase().replace(/["”″]/g, '"');
  if (unit.category === 'Television') return tvSize(text.replace(/\b(\d{2,3})\s*(?:inch|in\b)/g, '$1"'));
  const rules = RULES[unit.category];
  if (!rules) return null;
  for (const [needle, label] of rules) {
    if (text.includes(needle)) return label;
  }
  return null;
}
