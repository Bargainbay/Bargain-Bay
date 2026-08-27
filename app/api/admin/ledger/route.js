// Opening balances, and the ledger as CSV. Setting the opening balances is
// ADMIN only — it defines what every statement is measured from. Reading is
// open to a granted accountant, which is the point of them being here.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, canKeepBooks } from '../../../../lib/auth';
import { setOpeningBalances, journal, trialBalance, getOpeningBalances } from '../../../../lib/ledger';
import { setPurchaseInvoicePaid, unpaidPurchaseInvoices } from '../../../../lib/finance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'opening') return NextResponse.json({ ok: true, ...(await setOpeningBalances(b)) });
    // Settling a supplier invoice: it leaves payables and the cash leaves the
    // bank, both dated to the day it was actually paid.
    if (b.action === 'pay_purchase') {
      await setPurchaseInvoicePaid(b.id, b.paidAt);
      return NextResponse.json({ ok: true, unpaid: await unpaidPurchaseInvoices() });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}

// Every journal line in the period, one row per line — the general ledger detail
// an accountant works from.
export async function GET(req) {
  const s = await getSession();
  if (!(await canKeepBooks(s))) return new Response('Not authorized', { status: 403 });
  const opening = await getOpeningBalances();
  if (!opening.set) return new Response('Opening balances have not been set.', { status: 400 });
  const to = new URL(req.url).searchParams.get('to')
    || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

  const entries = await journal(opening.asOf, to);
  const cell = (v) => {
    const str = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = [['Date', 'Account', 'Account name', 'Memo', 'Reference', 'Debit', 'Credit']];
  const { ACCOUNTS } = await import('../../../../lib/ledger');
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([e.date, l.code, ACCOUNTS[l.code]?.name || '', e.memo, e.ref || '',
                 l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '']);
    }
  }
  const tb = await trialBalance(to);
  rows.push([], ['', '', '', 'TOTALS', '', tb.debits.toFixed(2), tb.credits.toFixed(2)]);

  return new Response(rows.map((r) => r.map(cell).join(',')).join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bargain-bay-general-ledger-${opening.asOf}-to-${to}.csv"`
    }
  });
}
