import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { revenueDashboard, customerList, inventoryFinancials, DASH_PERIODS } from '../../../lib/analytics';
import AdminNav from '../../../components/AdminNav';
import DashboardFilters from '../../../components/DashboardFilters';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const periodLabel = (key) => (DASH_PERIODS.find((p) => p.key === key) || {}).label || '';

// ── Trend chart ──────────────────────────────────────────────────────────────
// Server-rendered SVG. Continuous buckets (zeros filled upstream), value labels
// on sparse series, current bucket highlighted, average line, hover tooltips.
function TrendChart({ series, unit }) {
  if (!series.length) return <p className="hint">No sales in this period yet.</p>;
  const n = series.length;
  const total = series.reduce((s, d) => s + d.revenue, 0);
  const nonZero = series.filter((d) => d.revenue > 0).length;
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
      {/* gridlines + y labels */}
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

      {/* average line */}
      {avg > 0 && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={avgY} y2={avgY} stroke="var(--taupe)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
          <text x={W - pad.r} y={avgY - 5} textAnchor="end" fontSize="9.5" fill="var(--taupe-dark)">avg {money(avg)}</text>
        </g>
      )}

      {/* bars */}
      {series.map((d, i) => {
        const h = plotH * (d.revenue / max);
        const cx = pad.l + i * bw + bw / 2;
        const isLast = i === n - 1;
        const showLabel = (i % labelEvery === 0) || isLast;
        return (
          <g key={i}>
            <title>{d.label}: {money(d.revenue)} · {d.orders} order{d.orders === 1 ? '' : 's'}</title>
            <rect x={cx - barW / 2} y={H - pad.b - h} width={barW} height={Math.max(h, d.revenue > 0 ? 2 : 0)} rx="3"
              fill={isLast ? 'var(--charcoal)' : 'var(--taupe)'} />
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

export default async function DashboardPage({ searchParams }) {
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
    return (<div><AdminNav active="dashboard" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>);
  }

  const period = DASH_PERIODS.some((p) => p.key === searchParams?.period) ? searchParams.period : 'month';

  let data = null, customers = [], error = '';
  try {
    [data, customers] = await Promise.all([revenueDashboard(period), customerList()]);
  } catch (e) {
    console.error('dashboard load failed', e.message);
    error = 'Could not load dashboard data — if you just deployed, run the schema migration under Operations.';
  }
  if (error || !data) {
    return (<div><AdminNav active="dashboard" /><div className="error-box">{error || 'No data.'}</div></div>);
  }

  const k = data.kpis;
  const pipe = data.pipeline;
  const fin = await inventoryFinancials();
  const members = customers.filter((c) => c.memberStatus && c.memberStatus !== 'none');
  const vs = data.hasPrev ? ` vs ${data.prevLabel}` : '';

  return (
    <div>
      <AdminNav active="dashboard" />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '4px 0 14px' }}>
        <h1 style={{ color: 'var(--charcoal)', margin: 0 }}>Dashboard</h1>
        <span className="hint" style={{ margin: 0 }}>Showing <strong>{periodLabel(period)}</strong>{vs ? ` — compared${vs}` : ''}</span>
      </div>

      <DashboardFilters periods={DASH_PERIODS} active={period} />

      {/* Headline KPIs for the selected period, each vs the previous period */}
      <div className="dash-kpis">
        <Kpi label={`Revenue · ${periodLabel(period)}`} value={money(k.revenue)} delta={k.revenueDelta} />
        <Kpi label="Profit" value={money(k.profit)} delta={k.profitDelta}
          sub={k.unitsWithCost ? `${k.marginPct.toFixed(1)}% margin` : 'cost not tracked'} />
        <Kpi label="Orders" value={k.orders} delta={k.ordersDelta} />
        <Kpi label="Units sold" value={k.units} />
        <Kpi label="Avg order" value={money(k.avgOrder)} delta={k.avgDelta} />
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

      {/* Inventory & margins (current stock) */}
      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Inventory &amp; margins <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>(in stock now)</span></h2>
        {fin.unitsWithCost === 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            Per-unit cost isn&apos;t in the catalog yet — re-run the tracker sync to pull &quot;Total Cost&quot; and light up margins.
          </p>
        )}
        <div className="dash-kpis">
          <Kpi label="In-stock units" value={fin.units} />
          <Kpi label="Inventory cost" value={money(fin.inventoryCost)} sub="COGS in stock" />
          <Kpi label="Sale value" value={money(fin.suggestedValue)} sub="at listed prices" />
          <Kpi label="Potential profit" value={money(fin.potentialProfit)} sub={fin.unitsWithCost ? `${fin.marginPct.toFixed(1)}% margin` : null} />
          <Kpi label="Retail value" value={money(fin.retailValue)} />
        </div>
      </div>

      {/* Member + customer databases */}
      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Member database ({members.length})</h2>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Business / Name</th><th>Contact</th><th>Status</th><th>Orders</th><th style={{ textAlign: 'right' }}>Spent</th></tr></thead>
          <tbody>
            {members.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No member applications yet.</td></tr>}
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.business || m.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.name}</div></td>
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
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Customer database ({customers.length})</h2>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Name</th><th>Contact</th><th>Joined</th><th>Orders</th><th style={{ textAlign: 'right' }}>Total spent</th><th>Last order</th></tr></thead>
          <tbody>
            {customers.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No customer accounts yet.</td></tr>}
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.name || '—'}{c.role === 'member' && c.memberStatus === 'approved' ? <span className="pill ok" style={{ marginLeft: 6 }}>member</span> : null}</td>
                <td>{c.email}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone || ''}</div></td>
                <td>{fmtDate(c.createdAt)}</td>
                <td>{c.orders}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.spent)}</td>
                <td>{fmtDate(c.lastOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
