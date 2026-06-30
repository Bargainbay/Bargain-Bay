import { NextResponse } from 'next/server';
import { soldUnitsMissingCost } from '../../../../lib/analytics';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Read-only ops diagnostic: which sold units have no cost on file (the gap that
// inflates profit/margin). Secret-gated (CRON_SECRET) like the other cron routes;
// no customer PII in the payload. Not on a schedule — called on demand.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const report = await soldUnitsMissingCost();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
