import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { fulfilmentDashboard, DASH_PERIODS } from '../../../lib/analytics';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import { Kpi, Donut, HBars, TrendChart } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fulfilment — Bargain Bay' };
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';
const plain = (n) => `${Math.round(n)}`;

export default async function FulfilmentDashboardPage({ searchParams }) {
  const sParams = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/fulfilment');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="fulfilment"><div className="panel">Database not configured.</div></DashboardShell>);

  const period = DASH_PERIODS.some((p) => p.key === sParams?.period) ? sParams.period : 'month';
  let d = null, error = '';
  try { d = await fulfilmentDashboard(period); } catch (e) { console.error('fulfilment load failed', e.message); error = 'Could not load fulfilment data.'; }
  if (error || !d) return (<DashboardShell active="fulfilment"><div className="error-box">{error || 'No data.'}</div></DashboardShell>);

  const k = d.kpis;
  return (
    <DashboardShell active="fulfilment">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Fulfilment &amp; supply chain</h1>
        <span className="hint" style={{ margin: 0 }}>Completions in <strong>{periodLabel(period)}</strong></span>
      </div>
      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label="Delivered / picked up" value={k.delivered} sub={`${k.deliveries} delivery · ${k.pickups} pickup`} />
        <Kpi label="On-time rate" value={`${k.onTimePct.toFixed(0)}%`} sub={`${k.onTime} on time · ${k.late} late`} />
        <Kpi label="Avg time to fulfil" value={k.avgDays ? `${k.avgDays.toFixed(1)} d` : '—'} sub="order → delivered" />
        <Kpi label="Proof-of-delivery" value={`${k.podPct.toFixed(0)}%`} sub={`${k.withPod}/${k.delivered} captured`} />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Open pipeline <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>(now)</span></h2>
          <HBars rows={d.activeStages.map((s, i) => ({ label: s.stage, value: s.count, color: ['var(--c3)', 'var(--c2)', 'var(--c1)'][i] }))} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>On-time vs delayed · {periodLabel(period)}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut label="On-time vs delayed"
              segments={[{ label: 'On time', value: k.onTime, color: 'var(--c1)' }, { label: 'Late', value: k.late, color: 'var(--c5)' }]}
              centerTop={k.onTime + k.late > 0 ? `${k.onTimePct.toFixed(0)}%` : '—'} centerSub="on time" />
            <div className="legend" style={{ flexDirection: 'column', gap: 8 }}>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c1)' }} /> On time — {k.onTime}</span>
              <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c5)' }} /> Late — {k.late}</span>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>Among scheduled deliveries with a target date.</p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Throughput · units fulfilled</h2>
        <TrendChart series={d.series} label="fulfilled" fmtVal={plain} accent="var(--c2)" />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Driver workload · {periodLabel(period)}</h2>
          <HBars rows={d.drivers.map((x) => ({ label: x.driver, value: x.stops, color: 'var(--c6)' }))} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Upcoming deliveries</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Order</th><th>City</th><th>Date</th><th>Driver</th></tr></thead>
            <tbody>
              {d.upcoming.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Nothing scheduled.</td></tr>}
              {d.upcoming.map((o) => (
                <tr key={o.orderNumber}>
                  <td style={{ fontWeight: 700 }}>{o.orderNumber}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{o.status.replace(/_/g, ' ')}</div></td>
                  <td>{o.city || '—'}</td><td>{o.deliveryDate || '—'}</td><td>{o.driver || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
    </DashboardShell>
  );
}
