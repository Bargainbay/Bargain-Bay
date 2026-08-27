import { redirect } from 'next/navigation';
import { getSession, isAdmin, canKeepBooks } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { financialDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { listExpenses, listRecurringExpenses, listUnreviewedExpenses, listExpenseRules, suggestExpenseRules, getLedgerStart, EXPENSE_CATEGORIES } from '../../../lib/finance';
import { qboStatus } from '../../../lib/qbo';
import { plaidStatus } from '../../../lib/plaid';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import ExpenseEditor from '../../../components/ExpenseEditor';
import QboPanel from '../../../components/QboPanel';
import PlaidPanel from '../../../components/PlaidPanel';
import TaxReview from '../../../components/TaxReview';
import ExpenseRules from '../../../components/ExpenseRules';
import RuleSuggestions from '../../../components/RuleSuggestions';
import { Kpi, HBars, TrendChart } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Financial — Bargain Bay' };
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';
const methodLabel = (m) => ({ etransfer: 'E-transfer', cash: 'Cash', in_person: 'In person', card: 'Card', unspecified: 'Unspecified' }[m] || m);

export default async function FinancialDashboardPage({ searchParams }) {
  const sParams = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/financial');
  const admin = isAdmin(session);
  // A granted accountant works here too — categorising expenses and answering
  // HST is the job they were brought in to do. The feed connect/disconnect
  // controls stay admin-only below: linking a bank is an access grant.
  if (!(await canKeepBooks(session))) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) doesn&apos;t have access to the books.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="financial"><div className="panel">Database not configured.</div></DashboardShell>);

  const period = DASH_PERIODS.some((p) => p.key === sParams?.period) ? sParams.period : 'month';
  let d = null, expenses = [], recurring = [], unreviewed = [], rules = [], ledgerStart = '', suggestions = [], error = '';
  try {
    [d, expenses, recurring, unreviewed, rules, ledgerStart, suggestions] = await Promise.all([
      financialDashboard(period), listExpenses(), listRecurringExpenses(),
      listUnreviewedExpenses().catch(() => []),
      listExpenseRules().catch(() => []),
      getLedgerStart().catch(() => ''),
      suggestExpenseRules().catch(() => [])
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

      <div className="panel" style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Profit &amp; loss statement</h2>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            Revenue, cost of goods, every expense category, net profit — printable. <b>The books</b> is the full
            records pack, and where you grant an accountant access.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn accent" href="/admin/reports/pnl">Open the statement →</a>
          <a className="btn" href="/admin/reports/books">The books →</a>
        </div>
      </div>

      {/* Rules sit above the feeds they govern: what arrives tomorrow depends on
          what's set here today. */}
      {/* Above the rules list: this is where a first bank import gets dealt
          with, and it's the answer to "why am I still doing this by hand". */}
      {suggestions.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
            Patterns worth a rule
            <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>{suggestions.length}</span>
          </h2>
          <RuleSuggestions initial={suggestions} categories={EXPENSE_CATEGORIES} />
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
          Sorting rules
          {rules.length > 0 && <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>{rules.length}</span>}
        </h2>
        <ExpenseRules initial={rules} categories={EXPENSE_CATEGORIES} ledgerStart={ledgerStart} />
      </div>

      {admin && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
            Bank feed — transactions straight from the account
            {plaid.connected && <span className="pill ok" style={{ marginLeft: 8, fontSize: 11 }}>connected</span>}
          </h2>
          <PlaidPanel status={plaid} />
        </div>
      )}

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

      {admin && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
            QuickBooks — automatic expense tracking
            {qbo.connected && <span className="pill ok" style={{ marginLeft: 8, fontSize: 11 }}>connected</span>}
          </h2>
          <QboPanel status={qbo} />
        </div>
      )}

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
