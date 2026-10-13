// A part bought for one of OUR units, posted by RS Ops when the part is marked
// ordered with a price (or un-ordered, which voids it). Same shared key as the
// other /api/ops routes.
//
// It goes through lib/part-costs, so it lands in the unit's Parts Cost cell on the
// master tracker exactly as a part typed on /admin/part-costs does.
//
// NEVER returns cost: the answer says only whether it was recorded. RS Ops keeps
// the figure it sent; what a unit's total cost is stays in this building.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { upsertRsopsPartCost, voidRsopsPartCost, PartCostError } from '../../../../lib/part-costs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Part costs are not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

export async function POST(req) {
  const bad = keyProblem(req);
  if (bad) return bad;
  let b; try { b = await req.json(); } catch { b = {}; }
  const by = b.by ? `${String(b.by).slice(0, 80)} (RS Ops)` : 'RS Ops';
  try {
    if (b.action === 'void') return NextResponse.json(await voidRsopsPartCost({ unitId: b.unitId, partKey: b.partKey, by }));
    if (b.action === 'upsert') return NextResponse.json(await upsertRsopsPartCost({ ...b, by }));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    // A refusal a person has to resolve (hand-typed Parts Cost, unit not on the
    // tracker, tracker write refused) is a 409 with the reason; anything else is ours.
    const known = e instanceof PartCostError;
    if (!known) console.error('ops part-costs failed', e?.message);
    return NextResponse.json({ error: known ? e.message : (e?.message || 'Could not record that.') }, { status: known ? 409 : 500 });
  }
}
