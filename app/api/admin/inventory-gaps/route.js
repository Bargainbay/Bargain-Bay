import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import {
  inventoryGapsReport, linkSaleLine, runStockReconcile,
  listFillRequests, approveFillRequests, rejectFillRequests
} from '../../../../lib/stock-reconcile';

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
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const report = await inventoryGapsReport();
    // Fill requests carry what each unit COST — admin only, stripped here rather
    // than hidden in the browser.
    const fillRequests = isAdmin(s) ? await listFillRequests().catch(() => []) : null;
    return NextResponse.json({ ok: true, ...report, fillRequests, canApprove: isAdmin(s) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not build the report.' }, { status: 500 });
  }
}

// { action: 'link', itemId, skus } — tie a typed sale line to the unit(s) it sold;
//                                   several units split the line (`sku` still works for one)
// { action: 'check_rsops' }        — run the RS Ops → tracker pass now (no email)
// { action: 'approve_fills', ids }  — ADMIN: write the invoice's cost onto booked-in units
// { action: 'reject_fills', ids, note } — ADMIN: not the same appliance; add the line as new
export async function POST(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'approve_fills' || body.action === 'reject_fills') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can approve these.' }, { status: 403 });
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const r = body.action === 'approve_fills'
        ? await approveFillRequests(ids, { by: s.email })
        : await rejectFillRequests(ids, { by: s.email, note: body.note });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === 'link') return NextResponse.json({ ok: true, ...(await linkSaleLine(body.itemId, Array.isArray(body.skus) ? body.skus : body.sku)) });
    if (body.action === 'check_rsops') return NextResponse.json({ ok: true, ...(await runStockReconcile({ email: false })) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
