// Server-side inventory sync: read the master tracker's available units and
// upsert them into the Postgres `products` table. Units no longer in the
// tracker's "Tested Working" set are deactivated (drop off the storefront).
// Kept separate from lib/inventory so the heavy googleapis import isn't pulled
// into every page that just reads inventory.
import { readAvailable, sheetsConfigured } from './sheets';
import { hasDb, withTransaction } from './db';

export async function syncInventoryFromTracker() {
  if (!hasDb()) throw new Error('Database not configured (POSTGRES_URL).');
  if (!sheetsConfigured()) {
    throw new Error('Google Sheets not configured — set GOOGLE_CREDENTIALS and SHEET_ID in the environment.');
  }

  const units = await readAvailable(); // available "Tested Working" units from the tracker
  const skus = units.map((u) => u.id).filter(Boolean);

  return withTransaction(async (client) => {
    let synced = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.id) continue;
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
    // Deactivate anything no longer available in the tracker.
    const del = skus.length
      ? await client.query('UPDATE products SET active=false, synced_at=now() WHERE active=true AND NOT (sku = ANY($1))', [skus])
      : await client.query('UPDATE products SET active=false, synced_at=now() WHERE active=true');
    return { synced, deactivated: del.rowCount, total: units.length };
  });
}
