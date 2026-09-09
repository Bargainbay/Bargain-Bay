import { NextResponse } from 'next/server';
import { setTrackerStatus } from '../../../../lib/sheets';
import { markIntakeTested } from '../../../../lib/intake';

// RS Ops reporting a unit's real condition back to the master tracker.
//
// The tracker owns the retail price and derives the list price from the
// condition; RS Ops is the only thing that actually knows what state the machine
// is in, because it is the one that tested, repaired and cleaned it. This is the
// return leg of the pipeline that starts at /api/admin/purchase-intake.
//
// Machine-to-machine, same shared secret as the outbound manifest.
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
  const sku = String(body.sku || '').trim();
  const status = String(body.status || '').trim();
  const condition = body.condition ? String(body.condition).trim() : undefined;
  if (!sku || !status) return NextResponse.json({ error: 'sku and status are required' }, { status: 400 });

  try {
    // Going ON SALE is the one that needs the careful path: the Condition% and
    // Suggested-price cells are FORMULAS that recalc a beat after the condition
    // lands, and syncing too early reads a blank price and silently skips the
    // unit. markIntakeTested waits, syncs, and verifies it actually went live.
    if (/^tested working$/i.test(status)) {
      if (!condition) {
        return NextResponse.json({ error: 'A unit cannot go on sale without a condition — that is what prices it.' }, { status: 400 });
      }
      const r = await markIntakeTested(sku, { condition });
      return NextResponse.json({ ok: true, sku, status, condition, live: r.live });
    }
    // Every other status just keeps it off the site: the storefront sync only
    // ever imports rows reading exactly "tested working".
    await setTrackerStatus(sku, { status, condition });
    return NextResponse.json({ ok: true, sku, status, condition: condition || null, live: false });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Tracker write failed' }, { status: 502 });
  }
}
