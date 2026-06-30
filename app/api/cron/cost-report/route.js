import { NextResponse } from 'next/server';
import { soldUnitsMissingCost } from '../../../../lib/analytics';
import { setOrderItemCost } from '../../../../lib/orders';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Read-only ops diagnostic: which sold units have no cost on file (the gap that
// inflates profit/margin). Secret-gated (CRON_SECRET) like the other cron routes;
// no customer PII in the payload. Not on a schedule — called on demand.
export async function GET(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await soldUnitsMissingCost()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

// POST {order, sku, cost} → record a sold unit's cost (backfill / correction).
// Otherwise returns the report.
export async function POST(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  let body; try { body = await req.json(); } catch { body = {}; }
  if (body && body.order && body.sku && body.cost != null) {
    try {
      const r = await setOrderItemCost(body.order, body.sku, body.cost);
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 400 });
    }
  }
  try {
    return NextResponse.json({ ok: true, ...(await soldUnitsMissingCost()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
