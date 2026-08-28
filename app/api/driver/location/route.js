import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isDriver, touchDriverSeen } from '../../../../lib/drivers';
import { recordPings, prunePings } from '../../../../lib/driver-location';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Where the phone is. Its own route rather than another verb on /api/driver/jobs
// because it is the one request here that is allowed to FAIL SILENTLY and often:
// a position that doesn't arrive is a gap in a trail, while a completion that
// doesn't arrive is a delivery nobody can prove happened. They should not share
// a retry policy, an error surface, or the offline queue.
export async function POST(req) {
  const s = await getSession();
  if (!s || !hasDb() || !(await isDriver(s))) {
    return NextResponse.json({ error: 'Not a driver account.' }, { status: 403 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    const r = await recordPings(s.userId, body.pings, { jobId: body.jobId });
    touchDriverSeen(s.userId).catch(() => {});
    // Cheap, and only when a batch actually lands — the trail is worth keeping
    // for a month and worth nothing after that.
    if (Math.random() < 0.02) prunePings(30).catch(() => {});
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not record that.' }, { status: 400 });
  }
}
