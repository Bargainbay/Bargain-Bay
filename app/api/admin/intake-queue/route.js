import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listPendingIntake, commitIntake, rejectIntakeQueue } from '../../../../lib/intake-queue';
import { watchInvoiceInbox } from '../../../../lib/intake-watch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, pending: await listPendingIntake() });
  } catch (e) {
    return NextResponse.json({ ok: false, pending: [], error: e?.message || 'failed' }, { status: 200 });
  }
}

// POST { action: 'commit'|'reject'|'refresh', id?, vendor?, invoice?, items? }
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'refresh') {
      const r = await watchInvoiceInbox(); // pull the inbox now
      return NextResponse.json({ ok: true, ...r, pending: await listPendingIntake() });
    }
    if (body.action === 'reject') {
      await rejectIntakeQueue(Number(body.id));
      return NextResponse.json({ ok: true, pending: await listPendingIntake() });
    }
    if (body.action === 'commit') {
      const r = await commitIntake(Number(body.id), { vendor: body.vendor, invoice: body.invoice, items: body.items });
      return NextResponse.json({ ok: true, ...r, pending: await listPendingIntake() });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 400 });
  }
}
