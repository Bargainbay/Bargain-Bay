// Tag an order with a salesperson. Staff — crediting a sale is the selling
// side's own bookkeeping, and a rep who can't set it asks an admin to.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { setOrderRep } from '../../../../lib/reps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!(s && isStaff(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = Number(body.orderId);
  if (!id) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
  try {
    await setOrderRep(id, body.rep || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}
