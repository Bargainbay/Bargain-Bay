// Payroll: weekly report, rate config, manual labor entries. Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { payrollReport, getRates, setRates, logLabor, recentLabor, deleteLabor, payrollBalances, recordPayment, clearOwed, voidPayment } from '../../../../lib/payroll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const weekOffset = Number(new URL(req.url).searchParams.get('week') || 0);
  const [report, rates, recent, balances] = await Promise.all([payrollReport({ weekOffset }), getRates(), recentLabor(), payrollBalances().catch(() => null)]);
  return NextResponse.json({ report, rates, recent, balances });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'rates') return NextResponse.json({ ok: true, rates: await setRates(b.rates || {}) });
    if (b.action === 'pay') return NextResponse.json({ ok: true, id: await recordPayment({ worker: b.worker, amount: b.amount, paidOn: b.paidOn, note: b.note, by: (await getSession())?.email }) });
    if (b.action === 'clear') return NextResponse.json({ ok: true, ...(await clearOwed({ worker: b.worker, note: b.note, by: (await getSession())?.email })) });
    if (b.action === 'void_payment') { await voidPayment(b.id); return NextResponse.json({ ok: true }); }
    if (b.action === 'delete') { await deleteLabor(Number(b.id)); return NextResponse.json({ ok: true }); }
    // default: log a labor entry
    if (!b.worker) return NextResponse.json({ error: 'Worker name is required.' }, { status: 400 });
    const r = await logLabor({ worker: b.worker, date: b.date, tested: b.tested, cleaned: b.cleaned, repaired: b.repaired, hours: b.hours, note: b.note, source: 'admin' });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed.' }, { status: 500 });
  }
}
