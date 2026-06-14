// Server-safe search keyword builder. Expands each unit into a searchable blob
// with category synonyms + spec-derived terms (dimensions, configuration,
// features) so natural queries like "30 inch fridge" or "stainless gas range"
// return the right units.
const CAT_SYNONYMS = {
  'Refrigerator': 'refrigerator fridge',
  'Freezer': 'freezer deep freeze',
  'Washer': 'washer washing machine',
  'Dryer': 'dryer',
  'Washer/Dryer Combo': 'washer dryer combo all-in-one laundry',
  'Laundry Center': 'laundry center stacked washer dryer',
  'Laundry Pedestal': 'pedestal laundry drawer',
  'Dishwasher': 'dishwasher',
  'Range': 'range stove oven',
  'Wall Oven': 'wall oven',
  'Warming Drawer': 'warming drawer',
  'Range Hood': 'range hood vent exhaust',
  'Microwave': 'microwave',
  'Air Dresser': 'air dresser clothing care',
  'Appliance': ''
};

function widthTerms(w) {
  if (!w) return '';
  const r = Math.round(w);
  return `${r} inch ${r}in ${r}" ${w}`;
}

export function unitKeywords(unit, spec) {
  const parts = [
    unit.make, unit.model, unit.title, unit.category, unit.id,
    CAT_SYNONYMS[unit.category] || '', unit.condition || ''
  ];
  if (spec) {
    parts.push(spec.configuration, spec.capacity, spec.fuel, spec.finish);
    if (Array.isArray(spec.key_features)) parts.push(spec.key_features.join(' '));
    parts.push(widthTerms(spec.width_in));
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}
