import { NextResponse } from 'next/server';
import { syncPlaidTransactions } from '../../../../lib/plaid';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily bank-feed pull. The webhook keeps the ledger current through the day;
// this is the backstop that catches anything a missed or throttled webhook left
// behind, and the thing that keeps working if webhooks are never configured.
// No-ops cleanly until PLAID_CLIENT_ID + PLAID_SECRET are set.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    const result = await syncPlaidTransactions();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('cron sync-bank failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
