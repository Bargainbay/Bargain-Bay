import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { revenueDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { getSetting } from '../../../lib/settings';
import { listReps } from '../../../lib/reps';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import GoalEditor from '../../../components/GoalEditor';
import RepsEditor from '../../../components/RepsEditor';
import { Kpi, Donut, Funnel, TrendChart } from '../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';

function statusClass(s) {
  if (s === 'cancelled') return 'sold';
  if (s === 'pending_payment') return 'warn';
  return 'ok';
}

export default async function SalesDashboardPage({ searchParams }) {
  const sParams = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  if (!isStaff(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
      </div></div>
    );
  }
  // Sales associates see selling performance only — no cost-derived figures.
  const salesOnly = !isAdmin(session);
  if (!hasDb()) {
    return (<DashboardShell active="sales" salesOnly={salesOnly}><div className="panel">Database not configured — set POSTGRES_URL.</div></DashboardShell>);
  }

  const period = DASH_PERIODS.some((p) => p.key === sParams?.period) ? sParams.period : 'month';

  let data = null, goal = 0, repList = [], error = '';
  try {
    [data, goal, repList] = await Promise.all([revenueDashboard(period), getSetting('revenue_goal_monthly', 0), listReps()]);
  } catch (e) {
    console.error('sales dashboard load failed', e.message);
    error = 'Could not load dashboard data — if you just deployed, run the schema migration under Operations.';
  }
  if (error || !data) {
    return (<DashboardShell active="sales" salesOnly={salesOnly}><div className="error-box">{error || 'No data.'}</div></DashboardShell>);
  }

  const k = data.kpis;
  const pipe = data.pipeline;
  const deals = data.deals;
  const reps = data.reps || [];
  const vs = data.hasPrev ? ` vs ${data.prevLabel}` : '';
  const goalN = Number(goal) || 0;
  const goalPct = goalN > 0 ? Math.min((k.revenue / goalN) * 100, 100) : 0;
  const trend = data.series.map((s) => ({ label: s.label, value: s.revenue, hint: `${s.orders} order${s.orders === 1 ? '' : 's'}` }));

  return (
    <DashboardShell active="sales" salesOnly={salesOnly}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Sales performance</h1>
        <span className="hint" style={{ margin: 0 }}>Showing <strong>{periodLabel(period)}</strong>{vs ? ` — compared${vs}` : ''}</span>
      </div>

      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label={`Revenue (ex-HST) · ${periodLabel(period)}`} value={money(k.revenue)} delta={k.revenueDelta}
          sub={k.hstCollected ? `+ ${money(k.hstCollected)} HST collected` : 'pre-tax sales'} />
        {!salesOnly && (
          <Kpi label="Profit" value={money(k.profit)} delta={k.profitDelta}
            sub={k.unitsWithCost
              ? `${k.marginPct.toFixed(1)}% margin · on ${Math.round(k.costCoverage)}% of sales w/ cost`
              : 'no cost data yet'} />
        )}
        <Kpi label="Orders" value={k.orders} delta={k.ordersDelta} />
        <Kpi label="Units sold" value={k.units} />
        <Kpi label="Avg order" value={money(k.avgOrder)} delta={k.avgDelta} />
      </div>

      {period === 'month' && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Monthly revenue goal</h2>
            <GoalEditor current={goalN} />
          </div>
          {goalN > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
                <span style={{ color: 'var(--charcoal)' }}>{money(k.revenue)} of {money(goalN)}</span>
                <span style={{ color: 'var(--muted)' }}>{goalPct.toFixed(0)}% · {money(Math.max(goalN - k.revenue, 0))} to go</span>
              </div>
              <div className="goalbar"><span style={{ width: `${goalPct}%` }} /></div>
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 10 }}>Set a monthly revenue target to track progress here.</p>
          )}
        </div>
      )}

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Deals won / lost · {periodLabel(period)}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut
              label="Deals won and lost"
              segments={[
                { label: 'Won', value: deals.won, color: 'var(--c1)' },
                { label: 'Lost', value: deals.lost, color: 'var(--c5)' },
                { label: 'Open', value: deals.open, color: 'var(--c3)' }
              ]}
              centerTop={deals.won + deals.lost > 0 ? `${deals.winRate.toFixed(0)}%` : '—'}
              centerSub={deals.won + deals.lost > 0 ? 'win rate' : 'no quotes'}
            />
            <div style={{ flex: '1 1 160px' }}>
              <div className="legend" style={{ flexDirection: 'column', gap: 8 }}>
                <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c1)' }} /> Won — {deals.won} ({money(deals.wonValue)})</span>
                <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c5)' }} /> Lost — {deals.lost}</span>
                <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--c3)' }} /> Open — {deals.open}</span>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>From quotes created this period. Won = accepted/converted; lost = voided/expired.</p>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sales funnel · {periodLabel(period)}</h2>
          <Funnel stages={[
            { label: 'Quotes created', value: data.funnel.quotes, color: 'var(--c3)' },
            { label: 'Quotes converted', value: data.funnel.converted, color: 'var(--c2)' },
            { label: 'Invoices paid', value: data.funnel.invoicesPaid, sub: money(data.funnel.paidValue), color: 'var(--c1)' },
            { label: 'Orders delivered', value: data.funnel.delivered, color: 'var(--c6)' }
          ]} />
        </div>
      </div>

      {/* Team & attribution */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>By salesperson · {periodLabel(period)}</h2>
          <RepsEditor current={repList} />
        </div>
        {reps.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
            <thead><tr><th>Rep</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.rep}>
                  <td>{r.rep}</td>
                  <td style={{ textAlign: 'right' }}>{r.orders}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenue)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{k.revenue > 0 ? ((r.revenue / k.revenue) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <p className="hint" style={{ marginTop: 10 }}>
            {repList.length === 0
              ? 'Add your salespeople, then tag each order with a rep in Operations to see per-person revenue here.'
              : 'No tagged sales in this period yet — tag orders with a rep in '}
            {repList.length > 0 && <a href="/admin/operations" style={{ textDecoration: 'underline' }}>Operations</a>}.
          </p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Cash in the pipeline</h2>
          <span className="hint" style={{ margin: 0 }}>Current outstanding — not affected by the date filter</span>
        </div>
        <div className="dash-kpis" style={{ marginTop: 12 }}>
          <Kpi label="Unpaid invoices" value={money(pipe.invoices.total)}
            sub={`${pipe.invoices.count} open${pipe.invoices.overdueCount ? ` · ${pipe.invoices.overdueCount} overdue (${money(pipe.invoices.overdueTotal)})` : ''}`} />
          <Kpi label="Open quotes" value={money(pipe.quotes.total)} sub={`${pipe.quotes.count} awaiting reply`} />
          <Kpi label="Total potential" value={money(pipe.invoices.total + pipe.quotes.total)} sub="invoices + quotes" />
        </div>
        {pipe.invoices.overdueCount > 0 && (
          <p className="hint" style={{ marginTop: 10 }}>
            {pipe.invoices.overdueCount} invoice{pipe.invoices.overdueCount === 1 ? ' is' : 's are'} past due —
            chase under <a href="/admin/invoices" style={{ textDecoration: 'underline' }}>Invoices</a>.
          </p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Revenue trend</h2>
          <span className="hint" style={{ margin: 0 }}>{money(k.revenue)} across {data.series.length} {data.unit}{data.series.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ marginTop: 10 }}><TrendChart series={trend} label="revenue" /></div>
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Top sellers · {periodLabel(period)}</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Revenue</th></tr></thead>
            <tbody>
              {data.topModels.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No sales in this period.</td></tr>}
              {data.topModels.map((m, i) => (
                <tr key={i}><td>{m.title}</td><td style={{ textAlign: 'right' }}>{m.qty}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(m.revenue)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sales by category · {periodLabel(period)}</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th>{!salesOnly && <th style={{ textAlign: 'right' }}>Profit</th>}</tr></thead>
            <tbody>
              {data.byCategory.length === 0 && <tr><td colSpan={salesOnly ? 3 : 4} style={{ color: 'var(--muted)' }}>No sales in this period.</td></tr>}
              {data.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td><td style={{ textAlign: 'right' }}>{c.units}</td>
                  <td style={{ textAlign: 'right' }}>{money(c.revenue)}</td>
                  {!salesOnly && <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.profit)}</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Top customers · {periodLabel(period)}</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Customer</th><th>Orders</th><th style={{ textAlign: 'right' }}>Spent</th></tr></thead>
            <tbody>
              {data.topCustomers.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No sales in this period.</td></tr>}
              {data.topCustomers.map((c) => (
                <tr key={c.email}>
                  <td>{c.name}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email}</div></td>
                  <td>{c.orders}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.spent)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Recent orders</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {data.recentOrders.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No orders yet.</td></tr>}
              {data.recentOrders.map((o) => (
                <tr key={o.orderNumber}>
                  <td style={{ fontWeight: 700 }}>{o.orderNumber}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(o.createdAt)}</div></td>
                  <td>{o.name}</td>
                  <td><span className={'pill ' + statusClass(o.status)}>{o.status.replace(/_/g, ' ')}</span></td>
                  <td style={{ textAlign: 'right' }}>{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
    </DashboardShell>
  );
}
