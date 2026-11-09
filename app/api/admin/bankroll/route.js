// The live bankroll: read it, add a cash / not-at-the-bank-yet entry, clear or void one, or ask the
// bank for the balance this minute. Books-level (admin or a granted accountant), same as the expense APIs.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { addEntry, clearEntry, voidEntry } from '../../../../lib/bankroll';
import { loadBankroll } from '../../../../lib/bankroll-load';
import { promoteActivity, sortIncome } from '../../../../lib/bank-activity';
import { liveBalances, refreshFromBank, syncPlaidTransactions } from '../../../../lib/plaid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function who() {
  const s = await getSession();
  return s && (await canKeepBooks(s)) ? s : null;
}

export async function GET(req) {
  if (!(await who())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const date = sp.get('date') || undefined;
  const days = sp.get('days') || undefined;
  try { return NextResponse.json({ ok: true, ...(await loadBankroll(date, { days })) }); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not read the bankroll.' }, { status: 500 }); }
}

export async function POST(req) {
  const session = await who();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const by = session.email || session.name || null;
  try {
    if (b.action === 'add') {
      const amt = Math.abs(Number(b.amount));
      const signed = b.direction === 'out' && b.kind !== 'count' ? -amt : amt;
      const id = await addEntry({ date: b.date, kind: b.kind, amount: signed, note: b.note, by, category: b.category, payee: b.payee });
      await audit(session, { action: 'bankroll.add', entity: 'bankroll', entityId: String(id), summary: `${{ cash: 'Cash', count: 'Cash count', pending: 'Not at the bank yet' }[b.kind] || b.kind}: ${signed} ${b.note || ''}`.trim() });
    } else if (b.action === 'clear') {
      await clearEntry(b.id, by, b.line || null);
    } else if (b.action === 'promote') {
      const r = await promoteActivity(b.activityId, { category: b.category, by });
      await audit(session, { action: 'bank.promote', entity: 'expense', entityId: r.extId, summary: `Bank transfer $${r.gross} sorted as ${b.category}` });
    } else if (b.action === 'sort_income') {
      const r = await sortIncome(b.activityId, { category: b.category, who: b.who });
      await audit(session, { action: 'bank.income', entity: 'bank_activity', entityId: String(r.id), summary: `Money in labelled ${r.category || 'none'}` });
    } else if (b.action === 'void') {
      await voidEntry(b.id, by);
      await audit(session, { action: 'bankroll.void', entity: 'bankroll', entityId: String(b.id), summary: 'Voided a bankroll entry' });
    } else if (b.action === 'live') {
      // Ask the bank itself, take whatever new lines are there, then the live balance. Billed per call.
      const notes = await refreshFromBank();
      const sync = await syncPlaidTransactions().catch((e) => ({ error: e.message }));
      const bal = await liveBalances();
      const out = await loadBankroll(b.viewDate || b.date, { days: b.days });
      return NextResponse.json({ ok: true, ...out, notes: [...notes, ...(bal.errors || [])], sync });
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await loadBankroll(b.viewDate || b.date, { days: b.days })) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That failed.' }, { status: 400 });
  }
}
