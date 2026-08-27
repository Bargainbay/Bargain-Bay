// Vendor → category rules, and the date the books start. Admin-only: both
// decide what lands in the ledger and what it's called.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listExpenseRules, saveExpenseRule, deleteExpenseRule, applyRulesToExisting,
         getLedgerStart, setLedgerStart } from '../../../../lib/finance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() { const s = await getSession(); return !!(s && isAdmin(s)); }

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'save') {
      await saveExpenseRule({ id: b.id, match: b.match, category: b.category, taxMode: b.taxMode });
      return NextResponse.json({ ok: true, rules: await listExpenseRules() });
    }
    // Save and immediately sort the rows that prompted it — a rule that only
    // helps future transactions leaves the pile it was written for untouched.
    if (b.action === 'save_and_apply') {
      await saveExpenseRule({ match: b.match, category: b.category, taxMode: b.taxMode });
      const r = await applyRulesToExisting();
      return NextResponse.json({ ok: true, ...r, rules: await listExpenseRules() });
    }
    if (b.action === 'delete') {
      await deleteExpenseRule(b.id);
      return NextResponse.json({ ok: true, rules: await listExpenseRules() });
    }
    // Sort what's already in the ledger. Only fills blanks — see the lib.
    if (b.action === 'apply') {
      const r = await applyRulesToExisting();
      return NextResponse.json({ ok: true, ...r, rules: await listExpenseRules() });
    }
    if (b.action === 'ledger_start') {
      return NextResponse.json({ ok: true, ledgerStart: await setLedgerStart(b.ledgerStart) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ rules: await listExpenseRules(), ledgerStart: await getLedgerStart() });
}
