// Salvage / parts-only workflow. Salvage units live in the tracker (Status
// "Salvage For Parts Only") and never hit the storefront. We sync them into
// salvage_units, then invoice them (bulk or per-unit) and mark them disposed.
import { hasDb, query, withTransaction } from './db';
import { readSalvage } from './sheets';

// Pull salvage units from the tracker; preserve disposed status across re-sync.
export async function syncSalvage() {
  if (!hasDb()) throw new Error('Database not configured');
  const units = (await readSalvage()).filter((u) => u && u.id);
  return withTransaction(async (client) => {
    let synced = 0;
    for (const u of units) {
      await client.query(
        `INSERT INTO salvage_units (sku, make, model, title, cost, synced_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (sku) DO UPDATE SET
           make = EXCLUDED.make, model = EXCLUDED.model, title = EXCLUDED.title,
           cost = EXCLUDED.cost, synced_at = now()`,
        [u.id, u.make || null, u.model || null, u.title || null, u.cost ?? null]
      );
      synced++;
    }
    return { synced, total: units.length };
  });
}

const numify = (r) => ({
  ...r,
  cost: r.cost == null ? null : Number(r.cost),
  sale_price: r.sale_price == null ? null : Number(r.sale_price),
  disposed_at: r.disposed_at ? r.disposed_at.toISOString() : null
});

export async function listSalvage() {
  if (!hasDb()) return { available: [], disposed: [], stats: { availableCount: 0, disposedCount: 0, salvageRevenue: 0 } };
  const { rows } = await query(
    `SELECT sku, make, model, title, cost, status, sale_price, invoice_number, disposed_at
       FROM salvage_units ORDER BY status ASC, disposed_at DESC NULLS LAST, sku ASC`
  );
  const available = rows.filter((r) => r.status !== 'disposed').map(numify);
  const disposed = rows.filter((r) => r.status === 'disposed').map(numify);
  const salvageRevenue = disposed.reduce((a, r) => a + (Number(r.sale_price) || 0), 0);
  return { available, disposed, stats: { availableCount: available.length, disposedCount: disposed.length, salvageRevenue } };
}

// Mark units disposed (sold for parts) with the invoice they went on + price.
export async function markSalvageDisposed(skus, { invoiceNumber = null, prices = {} } = {}) {
  if (!hasDb()) throw new Error('Database not configured');
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))];
  for (const sku of list) {
    const price = prices[sku] != null ? prices[sku] : null;
    await query(
      `UPDATE salvage_units SET status = 'disposed', invoice_number = $2, sale_price = $3, disposed_at = now()
        WHERE sku = $1 AND status <> 'disposed'`,
      [sku, invoiceNumber, price]
    );
  }
  return { disposed: list.length };
}
