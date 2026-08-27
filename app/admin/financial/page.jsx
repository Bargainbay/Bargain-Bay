import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { financialDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { listExpenses, listRecurringExpenses, listUnreviewedExpenses, EXPENSE_CATEGORIES } from '../../../lib/finance';
import { qboStatus } from '../../../lib/qbo';
import { plaidStatus } from '../../../lib/plaid';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import ExpenseEditor from '../../../components/ExpenseEditor';
import QboPanel from '../../../components/QboPanel';
import PlaidPanel from '../../../components/PlaidPanel';
import TaxReview from '../../../components/TaxReview';
import { Kpi, HBars, TrendChart } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Financial — Bargain Bay' };
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';
const methodLabel = (m) => ({ etransfer: 'E-transfer', cash: 'Cash', in_person: 'In person', card: 'Card', unspecified: 'Unspecified' }[m] || m);

export default async function FinancialDashboardPage({ searchParams }) {
  const sParams = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/financial');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="financial"><div className="panel">Database not configured.</div></DashboardShell>);

  const period = DASH_PERIODS.some((p) => p.key === sParams?.period) ? sParams.period : 'month';
  let d = null, expenses = [], recurring = [], unreviewed = [], error = '';
  try {
    [d, expenses, recurring, unreviewed] = await Promise.all([
      financialDashboard(period), listExpenses(), listRecurringExpenses(),
      listUnreviewedExpenses().catch(() => [])
    ]);
  } catch (e) { console.error('financial load failed', e.message); error = 'Could not load financial data.'; }
  let qbo = { configured: false, connected: false };
  try { qbo = await qboStatus(); } catch { /* panel shows setup state */ }
  let plaid = { configured: false, connected: false, institutions: [] };
  try { plaid = await plaidStatus(); } catch { /* panel shows setup state */ }
  if (error || !d) return (<DashboardShell active="financial"><div className="error-box">{error || 'No data.'}</div></DashboardShell>);

  const k = d.kpis;
  const ag = d.aging;
  return (
    <DashboardShell active="financial">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Financial health</h1>
        <span className="hint" style={{ margin: 0 }}>P&amp;L for <strong>{periodLabel(period)}</strong></span>
      </div>
      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label="Revenue" value={money(k.revenue)} />
        <Kpi label="Gross profit" value={money(k.grossProfit)} sub={`${k.marginPct.toFixed(1)}% margin · COGS ${money(k.cogs)}`} />
        <Kpi label="Labor" value={money(k.labor || 0)} sub="crew pay this period (payroll)" />
        <Kpi label="Operating costs" value={money(k.opex)} sub={`${money(k.expenses)} ops + ${money(k.labor || 0)} labor + ${money(k.adSpend)} ads`} />
        <Kpi label="Net profit" value={money(k.netProfit)} sub="gross − labor − expenses − ads" />
        <Kpi label="Inventory capital" value={money(k.inventoryCost)} sub="COGS in stock" />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Gross profit trend</h2>
        <TrendChart series={d.series} label="profit" accent="var(--c1)" />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Accounts receivable <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>(open invoices, now)</span></h2>
          <HBars money rows={[
            { label: 'Current', value: ag.current, color: 'var(--c1)' },
            { label: '1–30 days overdue', value: ag.d30, color: 'var(--c4)' },
            { label: '31–60 days overdue', value: ag.d60, color: 'var(--c5)' },
            { label: '60+ days overdue', value: ag.d90, color: 'var(--danger)' }
          ]} />
          <p className="hint" style={{ marginTop: 10 }}>Total owed: <strong>{money(ag.total)}</strong>. Chase under <a href="/admin/invoices" style={{ textDecoration: 'underline' }}>Invoices</a>.</p>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Collections by method · {periodLabel(period)}</h2>
          {d.collections.length === 0
            ? <p className="hint" style={{ marginTop: 0 }}>No money collected in this period.</p>
            : <HBars money rows={d.collections.map((c, i) => ({ label: methodLabel(c.method), value: c.amount, color: ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c6)'][i % 4] }))} />}
          <p className="hint" style={{ marginTop: 10 }}>Total collected: <strong>{money(k.collected)}</strong></p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
          Bank feed — transactions straight from the account
          {plaid.connected && <span className="pill ok" style={{ marginLeft: 8, fontSize: 11 }}>connected</span>}
        </h2>
        <PlaidPanel status={plaid} />
      </div>

      {/* The review queue sits directly under the feed that fills it: an
          imported row claims no input tax credit until somebody says what tax
          was inside it, and this is where thousands of them get answered. */}
      {unreviewed.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
            HST to confirm
            <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>{unreviewed.length}</span>
          </h2>
          <TaxReview initial={unreviewed} />
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
          QuickBooks — automatic expense tracking
          {qbo.connected && <span className="pill ok" style={{ marginLeft: 8, fontSize: 11 }}>connected</span>}
        </h2>
        <QboPanel status={qbo} />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Operating expenses · {periodLabel(period)}</h2>
        {d.expensesByCategory.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <HBars money rows={d.expensesByCategory.map((e, i) => ({ label: e.category, value: e.amount, color: ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'][i % 5] }))} />
          </div>
        )}
        <p className="hint" style={{ marginTop: 0 }}>Log expenses to turn gross profit into <strong>true net profit</strong>. With the bank feed or QuickBooks connected above, card and account spends arrive on their own — this manual entry is for cash and anything neither can see.</p>
        <div style={{ marginTop: 10 }}>
          <ExpenseEditor initial={expenses} recurringInitial={recurring} categories={EXPENSE_CATEGORIES} />
        </div>
      </div>
    </DashboardShell>
  );
}
