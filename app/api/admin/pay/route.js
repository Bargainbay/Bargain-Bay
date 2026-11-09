// What each person is owed and what they have been paid. Books-level: admin or a granted accountant.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { addOwed, addPayment, voidPayLine, payCandidates, payBalances, linkWaitingPayments } from '../../../../lib/pay-ledger';
import { loadBankroll } from '../../../../lib/bankroll-load';
import { payrollWeek, postWeekOwed } from '../../../../lib/payroll-week';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The Payroll page asks for its own view; the Financial page's live list asks for the bankroll.
async function respond(b) {
  if (b.view === 'payroll') {
    await linkWaitingPayments().catch(() => {});
    return { payroll: await payrollWeek(b.weekStart), pay: await payBalances() };
  }
  return await loadBankroll(b.viewDate || undefined, { days: b.days });
}

export async function POST(req) {
  const session = await getSession();
  if (!session || !(await canKeepBooks(session))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const by = session.email || session.name || null;
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'candidates') {
      return NextResponse.json({ ok: true, candidates: await payCandidates({ amount: b.amount, date: b.date }) });
    }
    let extra = {};
    if (b.action === 'owed') {
      const id = await addOwed({ person: b.person, periodStart: b.periodStart, periodEnd: b.periodEnd, amount: b.amount, note: b.note, by });
      await audit(session, { action: 'pay.owed', entity: 'pay', entityId: String(id), summary: `Owed to ${b.person}: $${b.amount} for ${b.periodStart} to ${b.periodEnd}` });
    } else if (b.action === 'pay') {
      const r = await addPayment({ person: b.person, amount: b.amount, date: b.date, how: b.how, expenseId: b.expenseId || null,
        periodStart: b.periodStart, periodEnd: b.periodEnd, note: b.note, by });
      await audit(session, { action: 'pay.paid', entity: 'pay', entityId: String(r.id), summary: `Paid ${b.person} $${b.amount} (${b.how})` });
    } else if (b.action === 'post_week') {
      const r = await postWeekOwed({ person: b.person, weekStart: b.weekStart, by });
      await audit(session, { action: 'pay.post_week', entity: 'pay', entityId: String(r.id), summary: `Posted ${b.person}, week of ${b.weekStart}: $${r.amount}` });
    } else if (b.action === 'post_all') {
      const week = await payrollWeek(b.weekStart);
      let posted = 0; const skipped = [];
      for (const p of week.people) {
        if (!(p.total > 0)) continue;
        try { await postWeekOwed({ person: p.name, weekStart: b.weekStart, by }); posted++; } catch (e) { skipped.push(`${p.name}: ${e.message}`); }
      }
      await audit(session, { action: 'pay.post_all', entity: 'pay', summary: `Posted ${posted} people for the week of ${b.weekStart}` });
      extra = { posted, skipped };
    } else if (b.action === 'void') {
      await voidPayLine(b.id, by);
      await audit(session, { action: 'pay.void', entity: 'pay', entityId: String(b.id), summary: `Voided pay line #${b.id}` });
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...extra, ...(await respond(b)) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That failed.' }, { status: 400 });
  }
}
