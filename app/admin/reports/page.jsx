import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { reportsData } from '../../../lib/analytics';
import { money } from '../../../lib/constants';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — Bargain Bay' };

const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`;
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });
};

function Stat({ label, value, sub }) {
  return (
    <div className="panel" style={{ flex: '1 1 160px', minWidth: 150 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--charcoal)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RevenueChart({ data }) {
  if (!data.length) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>No sales yet.</p>;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const W = 640, H = 180, pad = 24, bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Monthly revenue">
      {data.map((d, i) => {
        const h = Math.round((d.revenue / max) * (H - pad * 2));
        const x = pad + i * bw, y = H - pad - h;
        return (
          <g key={d.month}>
            <rect x={x + 4} y={y} width={bw - 8} height={h} rx="3" fill="var(--accent, #c0392b)" opacity="0.85" />
            <text x={x + bw / 2} y={H - pad + 14} textAnchor="middle" fontSize="10" fill="#888">{monthLabel(d.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/reports');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return <div><AdminNav active="reports" /><div className="panel">Database not configured.</div></div>;

  const d = await reportsData();
  const r = d.revenue, rl = d.realized, inv = d.inventory, sv = d.salvage;

  return (
    <div>
      <AdminNav active="reports" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Reports</h1>

      <h2 style={{ color: 'var(--charcoal)' }}>Revenue</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="This month" value={money(r.thisMonth)} sub={`${r.thisMonthOrders} order${r.thisMonthOrders === 1 ? '' : 's'}`} />
        <Stat label="Last month" value={money(r.lastMonth)} />
        <Stat label="Year to date" value={money(r.ytd)} />
        <Stat label="All time" value={money(r.allTime)} />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Monthly revenue (last 12)</h2>
        <RevenueChart data={d.revenueByMonth} />
      </div>

      <h2 style={{ color: 'var(--charcoal)', marginTop: 24 }}>Realized margin (sold units)</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="Sold value" value={money(rl.soldValue)} sub={`${rl.units} unit${rl.units === 1 ? '' : 's'} sold`} />
        <Stat label="Cost of goods" value={money(rl.cost)} sub={`${rl.unitsWithCost}/${rl.units} have a tracked cost`} />
        <Stat label="Gross profit" value={money(rl.profit)} />
        <Stat label="Margin" value={pct(rl.marginPct)} />
      </div>
      {rl.unitsWithCost < rl.units && (
        <p className="hint" style={{ marginTop: 6 }}>Cost is missing for some sold units (e.g. invoice/salvage sales not in the catalog), so profit is a floor.</p>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sales by category</h2>
        {d.byCategory.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>No sales yet.</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
            <tbody>{d.byCategory.map((c) => (
              <tr key={c.category}><td>{c.category}</td><td style={{ textAlign: 'right' }}>{c.units}</td><td style={{ textAlign: 'right' }}>{money(c.revenue)}</td><td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(c.cost)}</td><td style={{ textAlign: 'right' }}>{money(c.profit)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Top sellers</h2>
        {d.topModels.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>No sales yet.</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Revenue</th></tr></thead>
            <tbody>{d.topModels.map((m, i) => (
              <tr key={i}><td>{m.title}</td><td style={{ textAlign: 'right' }}>{m.qty}</td><td style={{ textAlign: 'right' }}>{money(m.revenue)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <h2 style={{ color: 'var(--charcoal)', marginTop: 24 }}>Inventory & salvage</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="In-stock units" value={inv.units} sub={`${inv.unitsWithCost} with cost`} />
        <Stat label="Inventory cost" value={money(inv.inventoryCost)} />
        <Stat label="Potential profit" value={money(inv.potentialProfit)} sub={`${pct(inv.marginPct)} margin`} />
        <Stat label="Salvage revenue" value={money(sv.revenue)} sub={`${sv.disposed} unit${sv.disposed === 1 ? '' : 's'} disposed`} />
      </div>
    </div>
  );
}
