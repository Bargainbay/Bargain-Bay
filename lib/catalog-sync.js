// Inventory sync into the Postgres `products` table. Two sources share one
// upsert: the Google-tracker read (auto/nightly) and a CSV import (manual,
// keyless). Units no longer in the supplied set are deactivated (drop off site).
import { readAvailable, sheetsConfigured } from './sheets';
import { hasDb, query, withTransaction } from './db';

// units: [{ id, make, model, category, title, condition, price, compareAt, cost, uid }]
export async function upsertProducts(units) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const clean = (units || []).filter((u) => u && u.id);
  const skus = clean.map((u) => u.id);
  return withTransaction(async (client) => {
    // App-owned intake units are marked origin='intake' so the reconciliation
    // below never deactivates them (they aren't in the tracker). Ensure the
    // column exists before we reference it.
    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS origin text DEFAULT 'tracker'");
    let synced = 0;
    for (let i = 0; i < clean.length; i++) {
      const u = clean[i];
      await client.query(
        // active is forced false for any unit already marked sold locally, so a
        // re-import of a stale tracker row can't put a sold unit back on the site.
        `INSERT INTO products (sku, make, model, category, title, condition, price, compare_at, cost, uid, image_url, position, active, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now())
         ON CONFLICT (sku) DO UPDATE SET
           make=EXCLUDED.make, model=EXCLUDED.model, category=EXCLUDED.category,
           title=EXCLUDED.title, condition=EXCLUDED.condition, price=EXCLUDED.price,
           compare_at=EXCLUDED.compare_at, cost=EXCLUDED.cost, uid=EXCLUDED.uid,
           image_url=EXCLUDED.image_url, position=EXCLUDED.position,
           active=(products.sold_at IS NULL), synced_at=now()`,
        [u.id, u.make, u.model, u.category, u.title, u.condition, u.price, u.compareAt, u.cost ?? null, u.uid ?? null, u.imageUrl ?? null, i]
      );
      synced++;
    }
    const del = skus.length
      ? await client.query("UPDATE products SET active=false, synced_at=now() WHERE active=true AND origin IS DISTINCT FROM 'intake' AND NOT (sku = ANY($1))", [skus])
      : await client.query("UPDATE products SET active=false, synced_at=now() WHERE active=true AND origin IS DISTINCT FROM 'intake'");
    return { synced, deactivated: del.rowCount, total: clean.length };
  });
}

// Mark units sold locally (paid order or paid CRM invoice). Deactivates them so
// they drop off the storefront and stay off across re-import. sold_at is set once
// (first sale wins) so the original sale time/ref is preserved. Best-effort: a
// failure here must never block the payment path that calls it.
export async function markUnitsSold(skus, { channel = 'manual', ref = null, price = null } = {}) {
  if (!hasDb()) return { sold: 0 };
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!list.length) return { sold: 0 };
  const res = await query(
    `UPDATE products
        SET active = false,
            sold_at = COALESCE(sold_at, now()),
            sold_channel = COALESCE(sold_channel, $2),
            sold_ref = COALESCE(sold_ref, $3),
            sold_price = COALESCE(sold_price, $4),
            synced_at = now()
      WHERE sku = ANY($1)`,
    [list, channel, ref, price]
  );
  // A sold unit can't be on clearance — deactivate any markdown so it stops
  // cluttering the admin clearance list (and can't reapply if it's relisted).
  await query("UPDATE clearance SET active = false, updated_at = now() WHERE sku = ANY($1) AND active = true", [list])
    .catch((e) => console.error('clearance deactivate on sale failed', e.message));
  return { sold: res.rowCount };
}

// Units sold locally that the owner hasn't yet marked Sold in the master tracker.
// This is the reconciliation checklist shown in Operations.
export async function listSold({ pendingOnly = true } = {}) {
  if (!hasDb()) return [];
  const where = pendingOnly ? 'WHERE sold_at IS NOT NULL AND tracker_synced = false' : 'WHERE sold_at IS NOT NULL';
  const { rows } = await query(
    `SELECT sku, make, model, title, sold_at, sold_price, sold_channel, sold_ref, tracker_synced
       FROM products ${where} ORDER BY sold_at DESC`
  );
  return rows.map((r) => ({ ...r, sold_at: r.sold_at ? r.sold_at.toISOString() : null, sold_price: r.sold_price == null ? null : Number(r.sold_price) }));
}

// Un-sell a unit: clears the sold ledger, puts it back on the storefront, and
// cancels any non-cancelled order holding it (so availability stops blocking it).
// For a unit sold via a CRM invoice there's no order, so only the product flips.
export async function reactivateUnit(sku) {
  if (!hasDb()) throw new Error('Database not configured');
  const s = String(sku || '').trim();
  if (!s) return { ok: false };
  await query(
    `UPDATE products
        SET active = true, sold_at = null, sold_price = null, sold_channel = null,
            sold_ref = null, tracker_synced = false, synced_at = now()
      WHERE sku = $1`,
    [s]
  );
  const ords = await query(
    `UPDATE orders SET status = 'cancelled'
      WHERE status <> 'cancelled' AND id IN (SELECT order_id FROM order_items WHERE sku = $1)
      RETURNING id`,
    [s]
  );
  if (ords.rowCount) {
    await query('DELETE FROM reservations WHERE order_id = ANY($1)', [ords.rows.map((r) => r.id)]);
  }
  return { ok: true, cancelledOrders: ords.rowCount };
}

// Owner checked the unit off the reconciliation list (marked Sold in the tracker).
export async function markTrackerSynced(skus) {
  if (!hasDb()) return { updated: 0 };
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!list.length) return { updated: 0 };
  const res = await query('UPDATE products SET tracker_synced = true WHERE sku = ANY($1)', [list]);
  return { updated: res.rowCount };
}

export async function syncInventoryFromTracker() {
  if (!sheetsConfigured()) {
    throw new Error('Google Sheets not configured — set GOOGLE_CREDENTIALS and SHEET_ID in the environment.');
  }
  const units = await readAvailable();
  return upsertProducts(units);
}
