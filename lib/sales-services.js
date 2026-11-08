// The service price catalog the Sales Hub quotes from, with an INTERNAL cost on each
// service so a quote can show live profit. Owner-edited at /admin/sales/services.
//
// Customer prices come from the "RS Solutions Delivery Rate Sheet 2026". Internal costs
// the owner has stated are filled in (delivery $75 per order, haul-away $0 per unit);
// every other cost is left NULL — "nobody has entered it", which the profit panel says
// out loud instead of counting it as free.
import { hasDb, query } from './db';
import { starterRowsFromAddons } from './addons';

export const PRICING_TYPES = ['fixed', 'hourly', 'from', 'custom'];
export const COST_BASES = [['order', 'per order'], ['unit', 'per unit'], ['hour', 'per hour'], ['appliance', 'per appliance']];

const R = (name, side, pricingType, defaultPrice, internalCost, costBasis, bookable, description) =>
  ({ name, side, pricingType, defaultPrice, internalCost, costBasis, bookable, description });

// The "RS Solutions Delivery Rate Sheet 2026": delivery zones and accessorials here, the
// installations and haul-away from lib/addons.js (one definition, because those are also
// what the online checkout offers). The sheet has no internal costs; only the two the owner
// stated are filled in (delivery $75 per order, haul-away $0 per unit) and every other cost
// stays NULL — "not entered" — until he sets it.
// Not loaded, because they are billing rules and not things a quote adds: the completion-status
// percentages (bad address, not at home, refused, return to vendor, exchange) and the $2/km
// charge past Zone C (the catalog has no per-km unit).
export const STARTER_SERVICES = [
  R('Delivery – Zone A', 'rs', 'fixed', 95, 75, 'order', true, 'Delivery, Zone A (0–50 km from the pickup location).'),
  R('Delivery – Zone B', 'rs', 'fixed', 140, 75, 'order', true, 'Delivery, Zone B (51–100 km).'),
  R('Delivery – Zone C', 'rs', 'fixed', 225, 75, 'order', true, 'Delivery, Zone C (101–150 km). $2/km one way beyond Zone C is added by hand.'),
  R('Threshold delivery (front door or first dry area)', 'rs', 'custom', null, null, 'order', false, '80% of the order’s delivery pricing.'),
  R('Additional pieces (after 2)', 'rs', 'fixed', 15, null, 'unit', false, '$15 per item after the second.'),
  R('Overweight product (above 350 lbs)', 'rs', 'fixed', 75, null, 'unit', false, 'Per overweight item.'),
  R('Internal move (same floor)', 'rs', 'fixed', 20, null, 'unit', true, 'Per item. Same-floor moves only, paid in advance.'),
  R('Fridge door removal', 'rs', 'fixed', 20, null, 'unit', true, 'Per item.'),
  R('Home door removal', 'rs', 'fixed', 20, null, 'unit', true, 'Per item.'),
  ...starterRowsFromAddons(),
  R('Appliance repair – diagnostic', 'rs', 'from', null, null, 'order', true, 'Diagnostic visit.'),
  R('Maintenance plan', 'rs', 'custom', null, null, 'order', false, 'Per unit or per building; custom quote.'),
  R('Moving (per truck and crew)', 'rs', 'hourly', null, null, 'hour', true, 'Hourly, per truck and crew.'),
  R('AI integration', 'rs', 'custom', null, null, 'order', false, 'Custom quote.')
];

// Names an earlier version of the starting list used, replaced by the rate sheet's own.
const RETIRED_STARTER_NAMES = ['installation – standard', 'installation – gas range or dryer (existing hookup)'];

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

/**
 * Add whichever starter services are not there yet (by name). Never overwrites an edit:
 * an existing row is only touched to fill a price that is still BLANK, and to switch off the
 * two names the earlier starting list used, which the rate sheet's own names replace.
 */
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
    if (!rowCount && s.defaultPrice != null) {
      await query(`UPDATE services SET default_price = $2 WHERE lower(name) = lower($1) AND default_price IS NULL`, [s.name, s.defaultPrice]);
    }
  }
  await query(`UPDATE services SET active = false WHERE active AND lower(name) = ANY($1)`, [RETIRED_STARTER_NAMES]);
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
