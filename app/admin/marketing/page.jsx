import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { marketingDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { listAdSpend, AD_CHANNELS } from '../../../lib/finance';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import AdSpendEditor from '../../../components/AdSpendEditor';
import { Kpi, Funnel, HBars, TrendChart } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marketing — Bargain Bay' };
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';
const plain = (n) => `${Math.round(n)}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—');

export default async function MarketingDashboardPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/marketing');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="marketing"><div className="panel">Database not configured.</div></DashboardShell>);

  const period = DASH_PERIODS.some((p) => p.key === searchParams?.period) ? searchParams.period : 'month';
  let d = null, adSpendRows = [], error = '';
  try { [d, adSpendRows] = await Promise.all([marketingDashboard(period), listAdSpend()]); }
  catch (e) { console.error('marketing load failed', e.message); error = 'Could not load marketing data.'; }
  if (error || !d) return (<DashboardShell active="marketing"><div className="error-box">{error || 'No data.'}</div></DashboardShell>);

  const k = d.kpis;
  return (
    <DashboardShell active="marketing">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Marketing &amp; leads</h1>
        <span className="hint" style={{ margin: 0 }}>Activity in <strong>{periodLabel(period)}</strong></span>
      </div>
      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label="Leads" value={k.leads} sub={`${k.quoteRequests} quote requests · ${k.signups} signups`} />
        <Kpi label="Ad spend" value={money(k.adSpend)} sub={periodLabel(period)} />
        <Kpi label="Cost per lead" value={k.adSpend > 0 ? money(k.cpl) : '—'} sub={k.adSpend > 0 ? `${k.leads} leads` : 'add ad spend'} />
        <Kpi label="Cost per sale" value={k.adSpend > 0 ? money(k.cpa) : '—'} sub={`${k.invoicesPaid} paid`} />
        <Kpi label="Blended ROAS" value={k.adSpend > 0 ? `${k.roas.toFixed(1)}×` : '—'} sub="revenue ÷ ad spend" />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Lead → sale funnel · {periodLabel(period)}</h2>
          <Funnel stages={[
            { label: 'Leads (requests + signups)', value: k.leads, color: 'var(--c3)' },
            { label: 'Quotes created', value: k.quotes, color: 'var(--c2)' },
            { label: 'Quotes converted', value: k.converted, color: 'var(--c4)' },
            { label: 'Invoices paid', value: k.invoicesPaid, color: 'var(--c1)' }
          ]} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Ad spend by channel · {periodLabel(period)}</h2>
          {d.byChannel.length === 0
            ? <p className="hint" style={{ marginTop: 0 }}>No ad spend logged for this period — add it below.</p>
            : <HBars money rows={d.byChannel.map((c, i) => ({ label: c.channel, value: c.amount, color: ['var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'][i % 5] }))} />}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Leads over time</h2>
        <TrendChart series={d.leadSeries} label="leads" fmtVal={plain} accent="var(--c3)" />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Campaign sends · {periodLabel(period)}</h2>
        {d.campaigns.length === 0 ? (
          <p className="hint" style={{ marginTop: 0 }}>No campaigns sent in this period. Email/SMS sends from <a href="/admin/campaigns" style={{ textDecoration: 'underline' }}>Campaigns</a> are logged here going forward.</p>
        ) : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>When</th><th>Channel</th><th>Segment</th><th>Subject</th><th style={{ textAlign: 'right' }}>Sent</th></tr></thead>
            <tbody>
              {d.campaigns.map((c, i) => (
                <tr key={i}><td>{fmtDate(c.createdAt)}</td><td>{c.channel}</td><td>{c.segment || '—'}</td><td>{c.subject || '—'}</td><td style={{ textAlign: 'right' }}>{c.sent}/{c.recipients}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Ad spend ledger</h2>
        <p className="hint" style={{ marginTop: 0 }}>Log Meta / Google / other spend so ROAS and cost-per-lead become real. (A Meta Ads API sync can replace this later.)</p>
        <div style={{ marginTop: 10 }}><AdSpendEditor initial={adSpendRows} channels={AD_CHANNELS} /></div>
      </div>
    </DashboardShell>
  );
}
