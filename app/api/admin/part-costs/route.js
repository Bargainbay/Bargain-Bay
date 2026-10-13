// Parts bought for a specific unit. ADMIN only: it carries cost, and it writes
// to the master tracker.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { findUnits, partLinesFor, recentPartCosts, addPartCost, voidPartCost, PartCostError } from '../../../../lib/part-costs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  const u = new URL(req.url);
  try {
    const q = u.searchParams.get('q');
    const sku = u.searchParams.get('sku');
    if (q) return NextResponse.json({ units: await findUnits(q) });
    if (sku) return NextResponse.json({ lines: await partLinesFor(sku) });
    return NextResponse.json({ recent: await recentPartCosts() });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read.' }, { status: 500 });
  }
}

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'void') {
      const r = await voidPartCost(b.id, s.email);
      await audit(s, { action: 'part_cost.void', entity: 'unit_part_costs', entityId: String(b.id), summary: `Part cost entry ${b.id} voided; parts now $${r.partsTotal}`, detail: r }).catch(() => {});
      return NextResponse.json({ ok: true, ...r });
    }
    const r = await addPartCost(b, s.email);
    await audit(s, { action: 'part_cost.add', entity: 'unit_part_costs', entityId: String(b.sku), summary: `Part "${b.partName}" $${b.amount} on ${b.sku}; parts now $${r.partsTotal}`, detail: r }).catch(() => {});
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const status = e instanceof PartCostError ? 400 : 500;
    return NextResponse.json({ error: e?.message || 'Could not save.', needsAdopt: !!e?.needsAdopt }, { status });
  }
}
