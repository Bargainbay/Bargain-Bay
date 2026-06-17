// Inventory sync into the Postgres `products` table. Two sources share one
// upsert: the Google-tracker read (auto/nightly) and a CSV import (manual,
// keyless). Units no longer in the supplied set are deactivated (drop off site).
import { readAvailable, sheetsConfigured } from './sheets';
import { hasDb, withTransaction } from './db';

// units: [{ id, make, model, category, title, condition, price, compareAt, cost, uid }]
export async function upsertProducts(units) {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  const clean = (units || []).filter((u) => u && u.id);
  const skus = clean.map((u) => u.id);
  return withTransaction(async (client) => {
    let synced = 0;
    for (let i = 0; i < clean.length; i++) {
      const u = clean[i];
      await client.query(
        `INSERT INTO products (sku, make, model, category, title, condition, price, compare_at, cost, uid, position, active, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,now())
         ON CONFLICT (sku) DO UPDATE SET
           make=EXCLUDED.make, model=EXCLUDED.model, category=EXCLUDED.category,
           title=EXCLUDED.title, condition=EXCLUDED.condition, price=EXCLUDED.price,
           compare_at=EXCLUDED.compare_at, cost=EXCLUDED.cost, uid=EXCLUDED.uid,
           position=EXCLUDED.position, active=true, synced_at=now()`,
        [u.id, u.make, u.model, u.category, u.title, u.condition, u.price, u.compareAt, u.cost ?? null, u.uid ?? null, i]
      );
      synced++;
    }
    const del = skus.length
      ? await client.query('UPDATE products SET active=false, synced_at=now() WHERE active=true AND NOT (sku = ANY($1))', [skus])
      : await client.query('UPDATE products SET active=false, synced_at=now() WHERE active=true');
    return { synced, deactivated: del.rowCount, total: clean.length };
  });
}

export async function syncInventoryFromTracker() {
  if (!sheetsConfigured()) {
    throw new Error('Google Sheets not configured — set GOOGLE_CREDENTIALS and SHEET_ID in the environment.');
  }
  const units = await readAvailable();
  return upsertProducts(units);
}
