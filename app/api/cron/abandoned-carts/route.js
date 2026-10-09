import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { runAbandonedCartPass } from '../../../../lib/cron-jobs';
import { hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Hourly: staff digest of carts gone quiet + the customer reminder steps that
// are due. Its own schedule (see vercel.json) because a 4-hour step cannot wait
// for the nightly pass. Thin trigger over lib/cron-jobs.js.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ ok: false, error: 'POSTGRES_URL is not set.' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await runAbandonedCartPass()) });
  } catch (e) {
    console.error('abandoned-carts cron failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
