// The service price catalog the Sales Hub quotes from, with an INTERNAL cost on each
// service so a quote can show live profit. Owner-edited at /admin/sales/services.
//
// Customer prices come from the "RS Solutions Delivery Rate Sheet 2026". Internal costs
// the owner has stated are filled in (delivery $75 per order, haul-away $20 per unit);
// every other cost is left NULL — "nobody has entered it", which the profit panel says
// out loud instead of counting it as free.
import { hasDb, query } from './db';

export const PRICING_TYPES = ['fixed', 'hourly', 'from', 'custom'];
export const COST_BASES = [['order', 'per order'], ['unit', 'per unit'], ['hour', 'per hour'], ['appliance', 'per appliance']];

export const STARTER_SERVICES = [
  { name: 'Delivery – Zone A', side: 'rs', pricingType: 'fixed', defaultPrice: 95, internalCost: 75, costBasis: 'order', bookable: true, description: 'Delivery, Zone A from the pickup location.' },
  { name: 'Delivery – Zone B', side: 'rs', pricingType: 'fixed', defaultPrice: 140, internalCost: 75, costBasis: 'order', bookable: true, description: 'Delivery, Zone B.' },
  { name: 'Delivery – Zone C', side: 'rs', pricingType: 'fixed', defaultPrice: 225, internalCost: 75, costBasis: 'order', bookable: true, description: 'Delivery, Zone C.' },
  { name: 'Haul-away', side: 'both', pricingType: 'from', defaultPrice: null, internalCost: 20, costBasis: 'unit', bookable: true, description: 'Removal and disposal of the old appliance.' },
  { name: 'Installation – standard', side: 'both', pricingType: 'from', defaultPrice: null, internalCost: null, costBasis: 'appliance', bookable: true, description: 'Hookups and levelling. Set the price and cost per appliance type.' },
  { name: 'Installation – gas range or dryer (existing hookup)', side: 'rs', pricingType: 'fixed', defaultPrice: 250, internalCost: null, costBasis: 'appliance', bookable: true, description: 'Gas range or dryer, existing install.' },
  { name: 'Appliance repair – diagnostic', side: 'rs', pricingType: 'from', defaultPrice: null, internalCost: null, costBasis: 'order', bookable: true, description: 'Diagnostic visit.' },
  { name: 'Maintenance plan', side: 'rs', pricingType: 'custom', defaultPrice: null, internalCost: null, costBasis: 'order', bookable: false, description: 'Per unit or per building; custom quote.' },
  { name: 'Moving (per truck and crew)', side: 'rs', pricingType: 'hourly', defaultPrice: null, internalCost: null, costBasis: 'hour', bookable: true, description: 'Hourly, per truck and crew.' },
  { name: 'AI integration', side: 'rs', pricingType: 'custom', defaultPrice: null, internalCost: null, costBasis: 'order', bookable: false, description: 'Custom quote.' }
];

const cleanNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined; // undefined = invalid
};

const COLS = `id, side, name, description, pricing_type AS "pricingType", default_price AS "defaultPrice",
  internal_cost AS "internalCost", cost_basis AS "costBasis", bookable, active, sort`;

const asNumbers = (r) => ({ ...r, defaultPrice: r.defaultPrice == null ? null : Number(r.defaultPrice), internalCost: r.internalCost == null ? null : Number(r.internalCost) });

/** Active services. `forCustomer` strips the internal cost — it is for the rep and the owner only. */
export async function listServices({ includeInactive = false, withCost = true } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT ${COLS} FROM services ${includeInactive ? '' : 'WHERE active'} ORDER BY sort, name`
  ).catch(() => ({ rows: [] }));
  return rows.map(asNumbers).map((r) => (withCost ? r : { ...r, internalCost: null }));
}

export async function saveService(input) {
  if (!hasDb()) throw new Error('Database not configured.');
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Give the service a name.');
  const price = cleanNum(input.defaultPrice);
  const cost = cleanNum(input.internalCost);
  if (price === undefined) throw new Error('The price must be a number.');
  if (cost === undefined) throw new Error('The internal cost must be a number.');
  const side = ['bb', 'rs', 'both'].includes(input.side) ? input.side : 'rs';
  const pricingType = PRICING_TYPES.includes(input.pricingType) ? input.pricingType : 'fixed';
  const costBasis = COST_BASES.some(([k]) => k === input.costBasis) ? input.costBasis : 'order';
  const args = [side, name, String(input.description || '').slice(0, 500) || null, pricingType, price, cost, costBasis, !!input.bookable, input.active !== false];
  if (input.id) {
    const { rowCount } = await query(
      `UPDATE services SET side=$2, name=$3, description=$4, pricing_type=$5, default_price=$6, internal_cost=$7,
              cost_basis=$8, bookable=$9, active=$10 WHERE id=$1`, [Number(input.id), ...args]);
    if (!rowCount) throw new Error('Service not found.');
    return { id: Number(input.id) };
  }
  const { rows } = await query(
    `INSERT INTO services (side, name, description, pricing_type, default_price, internal_cost, cost_basis, bookable, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, args);
  return { id: rows[0].id };
}

/** Add whichever starter services are not there yet (by name). Never overwrites an edit. */
export async function addStarterServices() {
  if (!hasDb()) throw new Error('Database not configured.');
  let added = 0;
  for (const s of STARTER_SERVICES) {
    const { rowCount } = await query(
      `INSERT INTO services (side, name, description, pricing_type, default_price, internal_cost, cost_basis, bookable)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM services WHERE lower(name) = lower($2))`,
      [s.side, s.name, s.description, s.pricingType, s.defaultPrice, s.internalCost, s.costBasis, s.bookable]);
    added += rowCount;
  }
  return { added };
}

/** SKU -> cost (or null when nothing is on file). For the profit panel; callers must be canSeeCost. */
export async function costsForSkus(skus = []) {
  const list = [...new Set((skus || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  const out = Object.fromEntries(list.map((s) => [s, null]));
  if (!hasDb() || !list.length) return out;
  const { rows } = await query(`SELECT upper(sku) AS sku, cost FROM products WHERE upper(sku) = ANY($1)`, [list]).catch(() => ({ rows: [] }));
  for (const r of rows) out[r.sku] = r.cost == null ? null : Number(r.cost);
  return out;
}
