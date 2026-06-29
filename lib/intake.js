// Inventory intake — add units the business acquires (bought from a vendor like
// SecondShop, or haul-away units fixed & resold) straight into the catalog,
// without the Google tracker. Units land PENDING (off the storefront) until an
// owner confirms they're tested-working, then go live and become invoiceable.
//
// `origin = 'intake'` marks these as app-owned so the nightly tracker sync (which
// reconciles `active` from the tracker) never deactivates them. See catalog-sync.
import { hasDb, query } from './db';

let ensured = null;
export async function ensureIntakeColumns() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = Promise.all([
    query("ALTER TABLE products ADD COLUMN IF NOT EXISTS origin text DEFAULT 'tracker'"),
    query('ALTER TABLE products ADD COLUMN IF NOT EXISTS intake_status text'),
    query('ALTER TABLE products ADD COLUMN IF NOT EXISTS intake_source text'),
    query('ALTER TABLE products ADD COLUMN IF NOT EXISTS received_at timestamptz')
  ]).catch((e) => { ensured = null; throw e; });
  return ensured;
}

const n = (v) => Number(v || 0);
const titleOf = (make, model) => [make, model].filter(Boolean).join(' ').trim() || 'Unit';

// Create one or more pending intake units. Returns the new SKUs.
export async function addIntakeUnits({ make, model, category, condition, cost, price, source, qty = 1 }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureIntakeColumns();
  const count = Math.max(1, Math.min(50, Math.round(Number(qty) || 1)));
  const created = [];
  for (let i = 0; i < count; i++) {
    const tmp = `INTAKE-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${i}`;
    const { rows } = await query(
      `INSERT INTO products
         (sku, make, model, category, title, condition, cost, price, compare_at, position,
          active, origin, intake_status, intake_source, received_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,null,0,false,'intake','pending',$9,now(),now())
       RETURNING id`,
      [tmp, make || null, model || null, category || 'Other', titleOf(make, model),
       condition || null, cost != null && cost !== '' ? n(cost) : null, price != null && price !== '' ? n(price) : null, source || null]
    );
    const id = rows[0].id;
    const { rows: nm } = await query("UPDATE products SET sku = 'IN-' || (10000 + id) WHERE id = $1 RETURNING sku", [id]);
    created.push(nm[0].sku);
  }
  return { created, count };
}

export async function listIntakePending() {
  if (!hasDb()) return [];
  await ensureIntakeColumns();
  const { rows } = await query(
    `SELECT sku, make, model, category, title, condition, cost, price, intake_source, received_at
       FROM products WHERE origin = 'intake' AND intake_status = 'pending'
      ORDER BY received_at DESC, id DESC`
  );
  return rows.map((r) => ({
    sku: r.sku, make: r.make, model: r.model, category: r.category, title: r.title,
    condition: r.condition, cost: n(r.cost), price: n(r.price),
    source: r.intake_source, receivedAt: r.received_at ? r.received_at.toISOString() : null
  }));
}

// Confirm tested-working → publish: set the sale price, go active & live.
export async function markIntakeTested(sku, { price, condition } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureIntakeColumns();
  const p = Number(price);
  if (!(p > 0)) throw new Error('Set a sale price to publish the unit.');
  const { rows } = await query(
    `UPDATE products
        SET active = true, intake_status = 'live', price = $2,
            condition = COALESCE($3, condition), synced_at = now()
      WHERE sku = $1 AND origin = 'intake' AND intake_status = 'pending'
      RETURNING sku`,
    [String(sku), p, condition || null]
  );
  if (!rows.length) throw new Error('Unit not found or already processed.');
  return { sku: String(sku), live: true, price: p };
}

// Not tested-working — keep it off the store (e.g. route to repair / salvage).
export async function rejectIntake(sku) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureIntakeColumns();
  await query(
    "UPDATE products SET intake_status = 'rejected', active = false, synced_at = now() WHERE sku = $1 AND origin = 'intake'",
    [String(sku)]
  );
  return { sku: String(sku), rejected: true };
}
