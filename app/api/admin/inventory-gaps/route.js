import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { inventoryGapsReport, linkSaleLine, runStockReconcile } from '../../../../lib/stock-reconcile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Staff: pointing a sale at the appliance that actually went out is invoice work,
// the same thing a rep does in the invoice editor.
async function staff() {
  const s = await getSession();
  return s && isStaff(s) ? s : null;
}

export async function GET() {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await inventoryGapsReport()) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not build the report.' }, { status: 500 });
  }
}

// { action: 'link', itemId, sku }  — tie a typed sale line to a stock unit
// { action: 'check_rsops' }        — run the RS Ops → tracker pass now (no email)
export async function POST(req) {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'link') return NextResponse.json({ ok: true, ...(await linkSaleLine(body.itemId, body.sku)) });
    if (body.action === 'check_rsops') return NextResponse.json({ ok: true, ...(await runStockReconcile({ email: false })) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
