// The owner's side of the business-development rep's commission. ADMIN ONLY: it sets whose
// commission an account earns, edits a shop day, and approves what gets paid.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  getPlans, setRepPlan, getTiers, setTiers, statementFor, statementCsv, approveStatement, markStatementPaid, listStatements,
  recentShifts, fixShift, addShift, setCustomerOwner, setVendorSourcedBy, ownedAccounts, dayReport, CommissionError
} from '../../../../lib/sales-commission';
import { query, hasDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const admin = async () => { const s = await getSession(); return s && isAdmin(s) ? s : null; };
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  if (!(await admin())) return deny();
  const url = new URL(req.url);
  const rep = url.searchParams.get('rep') || '';
  const view = url.searchParams.get('view') || 'overview';
  try {
    if (view === 'statement') {
      const s = await statementFor(rep, url.searchParams.get('week') || '');
      if (url.searchParams.get('format') === 'csv') {
        return new NextResponse(statementCsv(s), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="commission-${s.weekStart}.csv"` } });
      }
      return NextResponse.json({ statement: s, history: await listStatements(rep) });
    }
    if (view === 'rep') {
      return NextResponse.json({
        shifts: await recentShifts(rep, 40), owned: await ownedAccounts(rep), day: await dayReport(rep)
      });
    }
    if (view === 'find') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2 || !hasDb()) return NextResponse.json({ customers: [], vendors: [] });
      const like = `%${q}%`;
      const [c, v] = await Promise.all([
        query(`SELECT id, name, email, phone, owner_email FROM customers WHERE lower(coalesce(email,'')) LIKE $1 OR lower(coalesce(name,'')) LIKE $1 OR coalesce(phone,'') LIKE $1 ORDER BY id DESC LIMIT 15`, [like]),
        query(`SELECT id, coalesce(trade_name, legal_name) AS name, contact_email, sourced_by_email FROM vendors WHERE lower(coalesce(trade_name,'')) LIKE $1 OR lower(legal_name) LIKE $1 OR lower(contact_email) LIKE $1 ORDER BY id DESC LIMIT 10`, [like]).catch(() => ({ rows: [] }))
      ]);
      return NextResponse.json({ customers: c.rows, vendors: v.rows });
    }
    return NextResponse.json({ plans: await getPlans(), tiers: await getTiers() });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'That did not work.' }, { status: e instanceof CommissionError ? 400 : 500 });
  }
}

export async function POST(req) {
  const session = await admin();
  if (!session) return deny();
  const b = await req.json().catch(() => ({}));
  const by = session.email;
  try {
    switch (b.action) {
      case 'set_plan': return NextResponse.json({ plan: await setRepPlan(b.rep, b.plan, by) });
      case 'remove_plan': return NextResponse.json({ plan: await setRepPlan(b.rep, null, by) });
      case 'set_tiers': return NextResponse.json({ tiers: await setTiers(b.tiers, by) });
      case 'approve': return NextResponse.json({ statement: await approveStatement(b.rep, b.week, by) });
      case 'paid': return NextResponse.json(await markStatementPaid(b.rep, b.week, by));
      case 'fix_shift': return NextResponse.json(await fixShift(b.id, b, by));
      case 'add_shift': return NextResponse.json(await addShift(b.rep, b, by));
      case 'set_owner': return NextResponse.json(await setCustomerOwner(b.customerId, b.owner, b.reason, by));
      case 'set_vendor': return NextResponse.json(await setVendorSourcedBy(b.vendorId, b.owner, b.reason, by));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message || 'That did not work.', code: e.code }, { status: e instanceof CommissionError ? 400 : 500 });
  }
}
