import { NextResponse } from 'next/server';
import { runNightly } from '../../../../lib/cron-jobs';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Every nightly job, back to back, in one request. NOT the schedule — the three
// jobs are scheduled separately in vercel.json precisely so each gets its own
// function time budget; running them together would give all three what one of
// them gets today. This is the "do the whole nightly pass right now" button, for
// catching up after an outage or checking the lot in one go.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runNightly()) });
  } catch (e) {
    console.error('cron nightly failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'nightly pass failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
