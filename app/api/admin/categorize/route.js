// The categorize workspace's data and bulk actions. Admins and granted
// accountants: sorting the books is exactly what an accountant is here to do.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import {
  listForCategorize, payeeGroups, categorizeStats, categorizeAccounts,
  bulkCategorize, annotateExpenses, markNeedsReview, restoreCategorized, idsForCategorize, EXPENSE_CATEGORIES
} from '../../../../lib/finance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const filtersOf = (sp) => ({
  status: sp.get('status') || 'review', q: sp.get('q') || '', from: sp.get('from') || '', to: sp.get('to') || '',
  account: sp.get('account') || '', category: sp.get('category') || '', min: sp.get('min') || '', max: sp.get('max') || '',
  sort: sp.get('sort') || 'date', limit: sp.get('limit') || 100, offset: sp.get('offset') || 0,
  ids: (sp.get('ids') || '').split(',').filter(Boolean)
});

export async function GET(req) {
  const session = await getSession();
  if (!(await canKeepBooks(session))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    const view = sp.get('view') || 'rows';
    if (view === 'meta') {
      const [stats, accounts] = await Promise.all([categorizeStats(), categorizeAccounts()]);
      return NextResponse.json({ ok: true, stats, accounts, categories: EXPENSE_CATEGORIES });
    }
    if (view === 'ids') return NextResponse.json({ ok: true, ...(await idsForCategorize(filtersOf(sp))) });
    if (view === 'groups') return NextResponse.json({ ok: true, ...(await payeeGroups(filtersOf(sp))) });
    return NextResponse.json({ ok: true, ...(await listForCategorize(filtersOf(sp))) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getSession();
  if (!(await canKeepBooks(session))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'categorize') {
      const r = await bulkCategorize({
        ids: b.ids, category: b.category, taxMode: b.taxMode, makeRule: !!b.makeRule,
        by: session?.email || ''
      });
      await audit(session, {
        action: 'expense.categorize', entity: 'expense',
        summary: `Categorized ${r.updated} transaction${r.updated === 1 ? '' : 's'} as ${b.category}${b.taxMode ? ` (HST: ${b.taxMode})` : ''}${r.rules.length ? `; saved ${r.rules.length} rule${r.rules.length === 1 ? '' : 's'}` : ''}`,
        detail: { count: r.updated, category: b.category, taxMode: b.taxMode || null, rules: r.rules }
      });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'restore') {
      const r = await restoreCategorized(b.rows);
      await audit(session, { action: 'expense.categorize.undo', entity: 'expense', summary: `Undid a bulk categorise of ${r.updated} transaction${r.updated === 1 ? '' : 's'}`, detail: { count: r.updated } });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'annotate') {
      const r = await annotateExpenses({ ids: b.ids, payee: b.payee, userNote: b.userNote });
      return NextResponse.json({ ok: true, ...r });
    }
    if (b.action === 'review_again') {
      const r = await markNeedsReview(b.ids);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}
