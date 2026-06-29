import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { revenueDashboard, DASH_PERIODS } from '../../../lib/analytics';
import { getSetting } from '../../../lib/settings';
import DashboardShell from '../../../components/DashboardShell';
import DashboardFilters from '../../../components/DashboardFilters';
import GoalEditor from '../../../components/GoalEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';

// ── Trend chart (dark) ───────────────────────────────────────────────────────
function TrendChart({ series, unit }) {
  if (!series.length) return <p className="hint">No sales in this period yet.</p>;
  const n = series.length;
  const total = series.reduce((s, d) => s + d.revenue, 0);
  const max = Math.max(...series.map((d) => d.revenue), 1);
  const avg = total / n;
  const W = 880, H = 280, pad = { l: 58, r: 16, t: 18, b: 36 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const bw = plotW / n;
  const barW = Math.min(bw * 0.66, 46);
  const y = (v) => pad.t + plotH * (1 - v / max);
  const showVals = n <= 14;
  const labelEvery = n <= 14 ? 1 : n <= 24 ? 2 : Math.ceil(n / 16);
  const avgY = y(avg);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Revenue by ${unit}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const gy = y(max * f);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={gy} y2={gy} stroke="var(--line-soft)" strokeWidth="1" />
            {(f === 0 || f === 0.5 || f === 1) && (
              <text x={pad.l - 8} y={gy + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{money(max * f)}</text>
            )}
          </g>
        );
      })}
      {avg > 0 && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={avgY} y2={avgY} stroke="var(--taupe)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
          <text x={W - pad.r} y={avgY - 5} textAnchor="end" fontSize="9.5" fill="var(--taupe-dark)">avg {money(avg)}</text>
        </g>
      )}
      {series.map((d, i) => {
        const h = plotH * (d.revenue / max);
        const cx = pad.l + i * bw + bw / 2;
        const isLast = i === n - 1;
        const showLabel = (i % labelEvery === 0) || isLast;
        return (
          <g key={i}>
            <title>{d.label}: {money(d.revenue)} · {d.orders} order{d.orders === 1 ? '' : 's'}</title>
            <rect x={cx - barW / 2} y={H - pad.b - h} width={barW} height={Math.max(h, d.revenue > 0 ? 2 : 0)} rx="3"
              fill="url(#barGrad)" opacity={isLast ? 1 : 0.82} />
            {showVals && d.revenue > 0 && (
              <text x={cx} y={H - pad.b - h - 5} textAnchor="middle" fontSize="9.5" fill="var(--charcoal)" fontWeight="600">{money(d.revenue)}</text>
            )}
            {showLabel && (
              <text x={cx} y={H - pad.b + 15} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Donut ring from weighted segments.
function Donut({ segments, centerTop, centerSub, size = 168, thickness = 24 }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Deals won and lost">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tint)" strokeWidth={thickness} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--charcoal)">{centerTop}</text>
      <text x="50%" y="62%" textAnchor="middle" fontSize="11.5" fill="var(--muted)">{centerSub}</text>
    </svg>
  );
}

// Horizontal funnel: rows with proportional bars.
function Funnel({ stages }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stages.map((s, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: 'var(--charcoal)' }}>{s.label}</span>
            <span style={{ color: 'var(--muted)' }}>{s.value}{s.sub ? ` · ${s.sub}` : ''}</span>
          </div>
          <div className="goalbar" style={{ height: 14 }}>
            <span style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 4 : 0)}%`, background: s.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Delta({ d }) {
  if (!d) return null;
  if (d.isNew) return <span className="kpi-delta up">▲ new</span>;
  const sym = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•';
  return <span className={'kpi-delta ' + d.dir}>{sym} {Math.abs(d.pct).toFixed(0)}%</span>;
}

function Kpi({ label, value, delta, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}{delta !== undefined ? <Delta d={delta} /> : null}</div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function statusClass(s) {
  if (s === 'cancelled') return 'sold';
  if (s === 'pending_payment') return 'warn';
  return 'ok';
}

export default async function SalesDashboardPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  if (!isAdmin(session)) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
        <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
      </div></div>
    );
  }
  if (!hasDb()) {
    return (<DashboardShell active="sales"><div className="panel">Database not configured — set POSTGRES_URL.</div></DashboardShell>);
  }

  const period = DASH_PERIODS.some((p) => p.key === searchParams?.period) ? searchParams.period : 'month';

  let data = null, goal = 0, error = '';
  try {
    [data, goal] = await Promise.all([revenueDashboard(period), getSetting('revenue_goal_monthly', 0)]);
  } catch (e) {
    console.error('sales dashboard load failed', e.message);
    error = 'Could not load dashboard data — if you just deployed, run the schema migration under Operations.';
  }
  if (error || !data) {
    return (<DashboardShell active="sales"><div className="error-box">{error || 'No data.'}</div></DashboardShell>);
  }

  const k = data.kpis;
  const pipe = data.pipeline;
  const deals = data.deals;
  const vs = data.hasPrev ? ` vs ${data.prevLabel}` : '';
  const goalN = Number(goal) || 0;
  const goalPct = goalN > 0 ? Math.min((k.revenue / goalN) * 100, 100) : 0;

  return (
    <DashboardShell active="sales">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>Sales performance</h1>
        <span className="hint" style={{ margin: 0 }}>Showing <strong>{periodLabel(period)}</strong>{vs ? ` — compared${vs}` : ''}</span>
      </div>

      <DashboardFilters periods={DASH_PERIODS} active={period} />

      <div className="dash-kpis">
        <Kpi label={`Revenue · ${periodLabel(period)}`} value={money(k.revenue)} delta={k.revenueDelta} />
        <Kpi label="Profit" value={money(k.profit)} delta={k.profitDelta}
          sub={k.unitsWithCost ? `${k.marginPct.toFixed(1)}% margin` : 'cost not tracked'} />
        <Kpi label="Orders" value={k.orders} delta={k.ordersDelta} />
        <Kpi label="Units sold" value={k.units} />
        <Kpi label="Avg order" value={money(k.avgOrder)} delta={k.avgDelta} />
      </div>

      {/* Monthly goal — only meaningful when viewing the current month */}
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

      {/* Deals won/lost + sales funnel */}
      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Deals won / lost · {periodLabel(period)}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut
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

      {/* Pipeline — current outstanding money, not affected by the date filter */}
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

      {/* Trend chart */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Revenue trend</h2>
          <span className="hint" style={{ margin: 0 }}>{money(k.revenue)} across {data.series.length} {data.unit}{data.series.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ marginTop: 10 }}><TrendChart series={data.series} unit={data.unit} /></div>
      </div>

      {/* What's selling — this period */}
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
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
            <tbody>
              {data.byCategory.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No sales in this period.</td></tr>}
              {data.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td><td style={{ textAlign: 'right' }}>{c.units}</td>
                  <td style={{ textAlign: 'right' }}>{money(c.revenue)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* Top customers (period) + recent orders */}
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

      <p className="hint" style={{ marginTop: 20, textAlign: 'center' }}>
        Inventory, customers &amp; financial detail are moving to their own dashboards (Fulfilment · Customers · Financial) as those ship.
      </p>
    </DashboardShell>
  );
}
