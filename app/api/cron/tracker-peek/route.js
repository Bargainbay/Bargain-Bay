import { NextResponse } from 'next/server';
import { trackerTabCsv } from '../../../../lib/sheets';
import { parseTrackerCsv, parseCsv } from '../../../../lib/csv';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Diagnostic: why aren't some tracker rows going live? Returns the sync's skip
// report plus the raw key fields (Status / Condition / Condition% / Suggested /
// Retail) for rows matching ?q= . Secret-gated.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') || '').toLowerCase();
  try {
    const csv = await trackerTabCsv();
    const { report } = parseTrackerCsv(csv);
    const grid = parseCsv(csv);
    if (!grid.length) return NextResponse.json({ ok: true, report, matches: [] });
    // The header isn't necessarily row 0 (title rows above it) — find it like the
    // sync does: the row that has an Item ID/SKU column AND a Status column.
    let hIdx = grid.findIndex((row) => row.some((c) => /item id|sku/i.test(c)) && row.some((c) => /status/i.test(c)));
    if (hIdx < 0) hIdx = 0;
    const header = grid[hIdx].map((h) => String(h || '').trim());
    const dataStart = hIdx + 1;
    const find = (re) => header.findIndex((h) => re.test(h));
    const ci = {
      sku: find(/item id|sku/i), make: find(/^make/i), model: find(/^model/i), desc: find(/description/i),
      status: find(/^status/i), condition: find(/^condition$/i), pct: find(/condition\s*%/i),
      suggested: find(/suggested/i), retail: find(/retail/i)
    };
    const at = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
    const numify = (s) => Number(String(s || '').replace(/[^0-9.]/g, '')) || 0;
    const rowInfo = (r) => ({
      sku: at(r, ci.sku), make: at(r, ci.make), model: at(r, ci.model),
      status: at(r, ci.status), condition: at(r, ci.condition), conditionPct: at(r, ci.pct),
      suggested: at(r, ci.suggested), retail: at(r, ci.retail)
    });
    const rows = grid.slice(dataStart);
    const matches = rows
      .filter((r) => q && [ci.make, ci.model, ci.desc].some((i) => at(r, i).toLowerCase().includes(q)))
      .slice(0, 20).map(rowInfo);
    // Replicate the sync's price rule: price = retail×condition% (else Suggested).
    const priceOf = (r) => {
      const retail = numify(at(r, ci.retail));
      let pct = numify(at(r, ci.pct)); if (pct > 1.5) pct = pct / 100;
      const computed = retail > 0 && pct > 0 ? Math.round(retail * pct * 100) / 100 : 0;
      return computed > 0 ? computed : numify(at(r, ci.suggested));
    };
    const noPrice = rows
      .filter((r) => /tested working/i.test(at(r, ci.status)) && priceOf(r) <= 0)
      .slice(0, 20).map((r) => ({ ...rowInfo(r), computedPrice: priceOf(r) }));
    // The most recently added rows (intake appends at the bottom) — to see exactly
    // what the last upload wrote.
    const tail = rows.filter((r) => at(r, ci.sku) || at(r, ci.make) || at(r, ci.model))
      .slice(-12).map((r) => ({ ...rowInfo(r), desc: at(r, ci.desc).slice(0, 50), computedPrice: priceOf(r) }));
    return NextResponse.json({ ok: true, report, matchCount: matches.length, matches, testedWorkingNoPrice: noPrice, tail });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
