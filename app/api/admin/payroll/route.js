// Payroll: weekly report, rate config, manual labor entries. Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { payrollReport, getRates, setRates, logLabor, recentLabor, deleteLabor } from '../../../../lib/payroll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const weekOffset = Number(new URL(req.url).searchParams.get('week') || 0);
  const [report, rates, recent] = await Promise.all([payrollReport({ weekOffset }), getRates(), recentLabor()]);
  return NextResponse.json({ report, rates, recent });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'rates') return NextResponse.json({ ok: true, rates: await setRates(b.rates || {}) });
    if (b.action === 'delete') { await deleteLabor(Number(b.id)); return NextResponse.json({ ok: true }); }
    // default: log a labor entry
    if (!b.worker) return NextResponse.json({ error: 'Worker name is required.' }, { status: 400 });
    const r = await logLabor({ worker: b.worker, date: b.date, tested: b.tested, cleaned: b.cleaned, repaired: b.repaired, hours: b.hours, note: b.note, source: 'admin' });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed.' }, { status: 500 });
  }
}
