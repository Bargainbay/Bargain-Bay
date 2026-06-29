// Inventory intake — add pending units, publish (tested-working), or reject.
// Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listIntakePending, addIntakeUnits, markIntakeTested, rejectIntake } from '../../../../lib/intake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ units: await listIntakePending() });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  if (!b.make && !b.model) return NextResponse.json({ error: 'Enter at least a make or model.' }, { status: 400 });
  try {
    const r = await addIntakeUnits(b);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not add.' }, { status: 500 });
  }
}

export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const sku = String(b.sku || '');
  if (!sku) return NextResponse.json({ error: 'Missing sku' }, { status: 400 });
  try {
    if (b.action === 'reject') return NextResponse.json({ ok: true, ...(await rejectIntake(sku)) });
    return NextResponse.json({ ok: true, ...(await markIntakeTested(sku, { condition: b.condition })) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update.' }, { status: 500 });
  }
}
