import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { trackerTabCsv } from '../../../../lib/sheets';
import { parseCsv } from '../../../../lib/csv';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Read-only: current products + tracker state for the Blomberg SKUs.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const prod = (await query(
      "SELECT sku, make, active, price, sold_at, synced_at FROM products WHERE make ILIKE '%blomberg%' OR sku LIKE 'IN-MR2Q7%'"
    )).rows;
    let tracker = [];
    try {
      const grid = parseCsv(await trackerTabCsv());
      let h = grid.findIndex((r) => r.some((c) => /item id|sku/i.test(c)) && r.some((c) => /status/i.test(c)));
      if (h < 0) h = 0;
      const H = grid[h].map((x) => String(x || '').trim());
      const ci = (re) => H.findIndex((x) => re.test(x));
      const c = { sku: ci(/item id|sku/i), make: ci(/^make/i), status: ci(/^status/i), pct: ci(/condition\s*%/i), sug: ci(/suggested/i), retail: ci(/retail/i) };
      tracker = grid.slice(h + 1).filter((r) => /blomberg/i.test(String(r[c.make] || '')))
        .map((r) => ({ sku: r[c.sku], status: r[c.status], pct: r[c.pct], suggested: r[c.sug], retail: r[c.retail] }));
    } catch (e) { tracker = [{ error: e.message }]; }
    return NextResponse.json({ ok: true, productsRows: prod, tracker });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
