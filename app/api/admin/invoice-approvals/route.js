// Asking an admin to approve a sale the consignment floor refused.
//   GET    staff: your own requests · admin: everything waiting + the last 3 days
//   POST   staff: file a request (the invoice body, as the form would have sent it)
//   PATCH  admin: { id, action: 'approve' | 'reject', note } · staff: { id, action: 'withdraw' }
// Approving raises the invoice immediately, credited to the rep who asked.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff, validEmail, normalizeEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { stockRuleProblem } from '../../../../lib/stock-reconcile';
import { requestApproval, listApprovals, approveRequest, rejectRequest, withdrawRequest } from '../../../../lib/invoice-approvals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const refuse = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const s = await getSession();
  if (!s || !isStaff(s)) return refuse();
  if (!hasDb()) return NextResponse.json({ requests: [] });
  try {
    return NextResponse.json({ admin: isAdmin(s), requests: await listApprovals(s, { admin: isAdmin(s) }) });
  } catch (e) {
    // Table not migrated yet: show nothing rather than breaking the dashboard.
    return NextResponse.json({ requests: [], error: e?.message || 'Could not load requests.' });
  }
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return refuse();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }

  // The same checks the invoice route makes before it gets as far as the floor, so
  // an admin is never asked to approve something that could not be raised anyway.
  const items = Array.isArray(body.items) ? body.items : [];
  if (!validEmail(normalizeEmail(body.email))) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 });
  if (!items.some((it) => String(it?.description || '').trim() && Number(it?.amount) > 0)) {
    return NextResponse.json({ error: 'Add at least one line item with a description and a positive amount.' }, { status: 400 });
  }
  if (body.deliveryMethod === 'delivery' && !['address', 'city', 'postal'].every((k) => String(body[k] || '').trim())) {
    return NextResponse.json({ error: 'Delivery requires a street address, city, and postal code.' }, { status: 400 });
  }
  const stockWrong = await stockRuleProblem(items).catch(() => null);
  if (stockWrong) return NextResponse.json({ error: stockWrong }, { status: 400 });

  try {
    const r = await requestApproval(s, { ...body, email: normalizeEmail(body.email) }, { note: body.repNote });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const status = e?.code === 'NOT_BELOW_FLOOR' ? 400 : 500;
    if (status === 500) console.error('approval request failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not send the request.' }, { status });
  }
}

export async function PATCH(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return refuse();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try {
    if (body.action === 'withdraw') return NextResponse.json(await withdrawRequest(id, s));
    // Approving raises an invoice below cost + 20%, which is the owner's call.
    if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can approve or reject.' }, { status: 403 });
    if (body.action === 'approve') return NextResponse.json({ ok: true, ...(await approveRequest(id, s, { note: body.note })) });
    if (body.action === 'reject') return NextResponse.json(await rejectRequest(id, s, { note: body.note }));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update that request.' }, { status: 400 });
  }
}
