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
    const header = grid[0].map((h) => String(h || '').trim());
    const find = (re) => header.findIndex((h) => re.test(h));
    const ci = {
      sku: find(/item id|sku/i), make: find(/^make/i), model: find(/^model/i), desc: find(/description/i),
      status: find(/^status/i), condition: find(/^condition$/i), pct: find(/condition\s*%/i),
      suggested: find(/suggested/i), retail: find(/retail/i)
    };
    const at = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
    const matches = grid.slice(1)
      .filter((r) => q && [ci.make, ci.model, ci.desc].some((i) => at(r, i).toLowerCase().includes(q)))
      .slice(0, 20)
      .map((r) => ({
        sku: at(r, ci.sku), make: at(r, ci.make), model: at(r, ci.model),
        status: at(r, ci.status), condition: at(r, ci.condition), conditionPct: at(r, ci.pct),
        suggested: at(r, ci.suggested), retail: at(r, ci.retail)
      }));
    return NextResponse.json({ ok: true, report, matchCount: matches.length, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
