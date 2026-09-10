import { NextResponse } from 'next/server';
import { nudgeOpenShifts } from '../../../../lib/shift-nudge';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Asks every driver still clocked on whether they have finished. Scheduled
// twice in vercel.json, either side of the UTC/Toronto boundary; the job itself
// checks the local hour and one of the two runs does nothing.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const url = new URL(req.url);
  try {
    return NextResponse.json({
      ok: true,
      // Deliberately NOT the request's host. A cron fires against the
      // deployment URL, and a driver's session cookie is host-only on
      // dispatch.rssolutions.ca — a link to the vercel.app host would open an
      // app that says they are not signed in. `?origin=` is for testing.
      ...(await nudgeOpenShifts({
        force: url.searchParams.get('force') === '1',
        origin: url.searchParams.get('origin') || undefined
      }))
    });
  } catch (e) {
    console.error('shift nudge failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'nudge failed' }, { status: 500 });
  }
}
export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
