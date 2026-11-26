import { NextResponse } from 'next/server';
import { modelPhotoRows, warmModelPhotos } from '../../../../lib/model-photos';
import { handlePhotoGaps } from '../../../../lib/catalog-sync';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Hourly: the Manager keeps an eye out for stock that has landed on the site
// without a stock photo and fixes it (lib/stock-photo-finder.js), so a new lot
// is never left on placeholder art until tomorrow night. The same pass runs at
// the end of every inventory sync; this one catches whatever got onto the site
// by any other road and retries models it could not find earlier (at most once
// a day each — handlePhotoGaps remembers). It reads the products table only:
// it does not touch the tracker and does not list or delist anything.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  try {
    await warmModelPhotos(true);
    const missing = (await modelPhotoRows()).filter((r) => r.source === 'missing');
    if (!missing.length) return NextResponse.json({ ok: true, missing: 0 });
    const r = await handlePhotoGaps(missing);
    // A failed pass must not count as a success: the health check is what says
    // the finder has stopped (the Manager no longer lists what it has not tried).
    return NextResponse.json({ ok: !r.error, missing: missing.length, set: r.fixed.length, stillMissing: r.remaining.length, told: r.told, error: r.error }, { status: r.error ? 500 : 200 });
  } catch (e) {
    console.error('stock photo pass failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
const beat = withHeartbeat('stock-photos', run);
export const GET = beat;
export const POST = beat;
