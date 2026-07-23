import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { customersDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { listCustomers } from '../../../lib/customers';
import { ratingStats } from '../../../lib/ratings';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import CustomerSearch from '../../../components/CustomerSearch';
import { Kpi, Donut, HBars } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers — Bargain Bay' };
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default async function CustomersDashboardPage({ searchParams }) {
  const sParams = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/customers');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="customers"><div className="panel">Database not configured.</div></DashboardShell>);

  const period = DASH_PERIODS.some((p) => p.key === sParams?.period) ? sParams.period : 'month';
  const q = String(sParams?.q || '').slice(0, 100);
  let d = null, customers = [], csat = null, error = '';
  try { [d, customers, csat] = await Promise.all([customersDashboard(period), listCustomers({ q }), ratingStats()]); }
  catch (e) { console.error('customers load failed', e.message); error = 'Could not load customer data.'; }
  if (error || !d) return (<DashboardShell active="customers"><div className="error-box">{error || 'No data.'}</div></DashboardShell>);

  const k = d.kpis;
  const members = customers.filter((c) => c.memberStatus && c.memberStatus !== 'none');
  const maxDist = Math.max(...csat.dist, 1);

  return (
    <DashboardShell active="customers">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Customer insights</h1>
        <span className="hint" style={{ margin: 0 }}>Activity in <strong>{periodLabel(period)}</strong></span>
      </div>
      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label="New signups" value={k.signups} sub={periodLabel(period)} />
        <Kpi label="Buyers" value={k.buyers} sub={`${k.newBuyers} new · ${k.returning} returning`} />
        <Kpi label="Repeat-purchase rate" value={`${k.repeatRate.toFixed(0)}%`} sub="all-time buyers" />
        <Kpi label="Avg lifetime value" value={money(k.clv)} sub="per buyer" />
        <Kpi label="Satisfaction" value={csat.count ? `${csat.avg.toFixed(1)}★` : '—'} sub={csat.count ? `${csat.count} ratings` : 'no ratings yet'} />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>New vs returning buyers · {periodLabel(period)}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut label="New vs returning"
              segments={[{ label: 'New', value: k.newBuyers, color: 'var(--c1)' }, { label: 'Returning', value: k.returning, color: 'var(--c2)' }]}
              centerTop={k.buyers || '—'} centerSub="buyers" />
            <div className="legend" style={{ flexDirection: 'column', gap: 8 }}>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c1)' }} /> New — {k.newBuyers}</span>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c2)' }} /> Returning — {k.returning}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Segments · {periodLabel(period)}</h2>
          <HBars money rows={d.segments.map((s, i) => ({ label: s.segment, value: s.revenue, sub: `${s.orders} orders`, color: ['var(--c2)', 'var(--c3)'][i % 2] }))} />
        </div>
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Where customers are · {periodLabel(period)}</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>City</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Revenue</th></tr></thead>
            <tbody>
              {d.geography.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No sales in this period.</td></tr>}
              {d.geography.map((g) => (
                <tr key={g.city}><td>{g.city}</td><td style={{ textAlign: 'right' }}>{g.orders}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(g.revenue)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Satisfaction (CSAT)</h2>
          {csat.count === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>No ratings yet — customers get a 1-tap star link in the &quot;delivered&quot; email.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[5, 4, 3, 2, 1].map((star) => (
                  <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 30, fontSize: 12.5, color: 'var(--muted)' }}>{star}★</span>
                    <div className="goalbar" style={{ flex: 1, height: 12 }}><span style={{ width: `${(csat.dist[star - 1] / maxDist) * 100}%`, background: 'var(--c4)' }} /></div>
                    <span style={{ width: 24, textAlign: 'right', fontSize: 12.5, color: 'var(--muted)' }}>{csat.dist[star - 1]}</span>
                  </div>
                ))}
              </div>
              {csat.recent.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {csat.recent.map((r, i) => (
                    <div key={i} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8, marginTop: 8, fontSize: 13 }}>
                      <span style={{ color: 'var(--c4)' }}>{'★'.repeat(r.rating)}</span>
                      <span style={{ color: 'var(--muted)' }}> · {r.orderNumber}</span>
                      <div style={{ color: 'var(--charcoal)' }}>{r.comment}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Member database ({members.length})</h2>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Business / Name</th><th>Contact</th><th>Status</th><th>Orders</th><th style={{ textAlign: 'right' }}>Spent</th></tr></thead>
          <tbody>
            {members.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No member applications yet.</td></tr>}
            {members.map((m) => (
              <tr key={m.id}>
                <td><a href={`/admin/customers/${m.id}`} style={{ textDecoration: 'underline' }}>{m.business || m.name || m.email}</a><div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.name}</div></td>
                <td>{m.email}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.phone || ''}</div></td>
                <td><span className={'pill ' + (m.memberStatus === 'approved' ? 'ok' : m.memberStatus === 'pending' ? 'warn' : 'sold')}>{m.memberStatus}</span></td>
                <td>{m.orders}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(m.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="hint" style={{ marginTop: 8 }}>Approve / reject members under <a href="/admin/operations" style={{ textDecoration: 'underline' }}>Operations</a>.</p>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Client database ({customers.length}{q ? ` matching “${q}”` : ''})</h2>
          <CustomerSearch initial={q} />
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Every client — guests, invoiced customers, and account holders alike. Click a name for their full
          history, notes, and editable contact details.
        </p>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Name</th><th>Contact</th><th>City</th><th>Since</th><th>Orders</th><th style={{ textAlign: 'right' }}>Total spent</th><th>Last order</th></tr></thead>
          <tbody>
            {customers.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>{q ? 'No customers match that search.' : 'No customers yet.'}</td></tr>}
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`/admin/customers/${c.id}`} style={{ textDecoration: 'underline', fontWeight: 600 }}>{c.name || c.email}</a>
                  {c.memberStatus === 'approved' ? <span className="pill ok" style={{ marginLeft: 6 }}>member</span> : null}
                  {!c.hasAccount ? <span className="pill" style={{ marginLeft: 6 }} title="No login account — bought as a guest or via invoice">guest</span> : null}
                </td>
                <td>{c.email}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone || ''}</div></td>
                <td>{c.city || '—'}</td>
                <td>{fmtDate(c.createdAt)}</td>
                <td>{c.orders}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.spent)}</td>
                <td>{fmtDate(c.lastOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </DashboardShell>
  );
}
