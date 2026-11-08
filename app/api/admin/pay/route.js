// What each person is owed and what they have been paid. Books-level: admin or a granted accountant.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { addOwed, addPayment, voidPayLine, payCandidates } from '../../../../lib/pay-ledger';
import { loadBankroll } from '../../../../lib/bankroll-load';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const session = await getSession();
  if (!session || !(await canKeepBooks(session))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const by = session.email || session.name || null;
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'candidates') {
      return NextResponse.json({ ok: true, candidates: await payCandidates({ amount: b.amount, date: b.date }) });
    }
    if (b.action === 'owed') {
      const id = await addOwed({ person: b.person, periodStart: b.periodStart, periodEnd: b.periodEnd, amount: b.amount, note: b.note, by });
      await audit(session, { action: 'pay.owed', entity: 'pay', entityId: String(id), summary: `Owed to ${b.person}: $${b.amount} for ${b.periodStart} to ${b.periodEnd}` });
    } else if (b.action === 'pay') {
      const r = await addPayment({ person: b.person, amount: b.amount, date: b.date, how: b.how, expenseId: b.expenseId || null,
        periodStart: b.periodStart, periodEnd: b.periodEnd, note: b.note, by });
      await audit(session, { action: 'pay.paid', entity: 'pay', entityId: String(r.id), summary: `Paid ${b.person} $${b.amount} (${b.how})` });
    } else if (b.action === 'void') {
      await voidPayLine(b.id, by);
      await audit(session, { action: 'pay.void', entity: 'pay', entityId: String(b.id), summary: `Voided pay line #${b.id}` });
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await loadBankroll(b.viewDate || undefined, { days: b.days })) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That failed.' }, { status: 400 });
  }
}
