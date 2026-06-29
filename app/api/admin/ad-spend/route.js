// Ad spend CRUD. Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listAdSpend, addAdSpend, deleteAdSpend } from '../../../../lib/finance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ adSpend: await listAdSpend() });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  if (!b.spentOn || !(Number(b.amount) > 0)) return NextResponse.json({ error: 'Date and amount are required.' }, { status: 400 });
  try {
    const id = await addAdSpend({ spentOn: b.spentOn, channel: b.channel, amount: b.amount, campaign: b.campaign, note: b.note });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try { await deleteAdSpend(id); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not delete.' }, { status: 500 }); }
}
