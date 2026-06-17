import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money } from '../../../lib/constants';
import { dashboardData, customerList, inventoryFinancials } from '../../../lib/analytics';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — Bargain Bay' };

const fmtMonth = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' });
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// Lightweight server-rendered SVG bar chart (no chart library / no client JS).
function RevenueChart({ data }) {
  if (!data.length) return <p className="hint">No sales yet — your revenue chart will appear here.</p>;
  const W = 720, H = 220, pad = { l: 48, r: 12, t: 12, b: 28 };
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Revenue by month" style={{ display: 'block' }}>
      {[0, 0.5, 1].map((f, i) => {
        const gy = y(max * f);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={gy} y2={gy} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={pad.l - 6} y={gy + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{money(max * f)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (H - pad.t - pad.b) * (d.revenue / max);
        const x = pad.l + i * bw + bw * 0.15;
        return (
          <g key={d.month}>
            <rect x={x} y={H - pad.b - h} width={bw * 0.7} height={Math.max(h, 0)} rx="3" fill="var(--taupe)" />
            <text x={x + bw * 0.35} y={H - pad.b + 14} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{fmtMonth(d.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
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

export default async function DashboardPage() {
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

  let data = null, customers = [], error = '';
  try {
    [data, customers] = await Promise.all([dashboardData(), customerList()]);
  } catch (e) {
    console.error('dashboard load failed', e.message);
    error = 'Could not load dashboard data — if you just deployed, run the schema migration under Operations.';
  }

  if (error || !data) {
    return (<div><AdminNav active="dashboard" /><div className="error-box">{error || 'No data.'}</div></div>);
  }

  const k = data.kpis;
  const fin = inventoryFinancials();
  const members = customers.filter((c) => c.memberStatus && c.memberStatus !== 'none');

  return (
    <div>
      <AdminNav active="dashboard" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Dashboard</h1>

      <div className="dash-kpis">
        <Kpi label="Revenue (paid)" value={money(k.revenue)} />
        <Kpi label="Orders" value={k.orders} sub={k.pendingOrders ? `${k.pendingOrders} pending` : null} />
        <Kpi label="Units sold" value={k.unitsSold} />
        <Kpi label="Avg order" value={money(k.avgOrder)} />
        <Kpi label="Customers" value={k.customers} />
        <Kpi label="Members" value={k.members} sub={k.pendingMembers ? `${k.pendingMembers} pending` : null} />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Revenue by month</h2>
        <RevenueChart data={data.revenueByMonth} />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Inventory &amp; margins</h2>
        {fin.unitsWithCost === 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            Per-unit cost isn&apos;t in the catalog yet — re-run the tracker sync (<code>npm run sync</code>) to pull "Total Cost" and light up margins. Counts shown below regardless.
          </p>
        )}
        <div className="dash-kpis">
          <Kpi label="In-stock units" value={fin.units} />
          <Kpi label="Inventory cost" value={money(fin.inventoryCost)} sub="COGS in stock" />
          <Kpi label="Sale value" value={money(fin.suggestedValue)} sub="at listed prices" />
          <Kpi label="Potential profit" value={money(fin.potentialProfit)} sub={fin.unitsWithCost ? `${fin.marginPct.toFixed(1)}% margin` : null} />
          <Kpi label="Retail value" value={money(fin.retailValue)} />
        </div>
        {fin.unitsWithCost > 0 && (
          <div className="table-wrap" style={{ marginTop: 14 }}><table className="admin">
            <thead><tr><th>Category</th><th>Units</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Sale value</th><th style={{ textAlign: 'right' }}>Potential profit</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
            <tbody>
              {fin.byCategory.map((b) => (
                <tr key={b.category}>
                  <td>{b.category}</td>
                  <td>{b.units}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.cost)}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.suggested)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(b.profit)}</td>
                  <td style={{ textAlign: 'right' }}>{b.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Top customers</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Customer</th><th>Orders</th><th style={{ textAlign: 'right' }}>Spent</th></tr></thead>
            <tbody>
              {data.topCustomers.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No sales yet.</td></tr>}
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
