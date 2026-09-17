import { NextResponse } from 'next/server';
import { acceptRsOpsUnits } from '../../../../lib/stock-reconcile';

// RS Ops handing over units the tracker may not have yet — the moment a unit's
// assessment is submitted, and again from the daily sweep. See
// acceptRsOpsUnits: each unit comes back on-tracker, re-keyed, added or skipped,
// and RS Ops treats every answer but "skipped" as linked.
//
// Machine-to-machine, the same shared secret as the manifest and status routes.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'RSOPS_INTAKE_KEY not set' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) {
    return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const units = Array.isArray(body.units) ? body.units : [];
  if (!units.length) return NextResponse.json({ error: 'units is empty' }, { status: 400 });
  try {
    const r = await acceptRsOpsUnits(units, { rsopsIds: Array.isArray(body.ids) ? body.ids : [] });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracker write failed' }, { status: 502 });
  }
}
