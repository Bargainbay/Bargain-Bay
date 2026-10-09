import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { dailyPnl } from '../../../lib/daily-pnl';
import { money, torontoToday } from '../../../lib/constants';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Daily P&L — Bargain Bay' };

const shift = (iso, d) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const label = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const signed = (v) => (v < 0 ? `(${money(-v)})` : money(v));

export default async function DailyPnlPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/daily-pnl');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="daily-pnl" /><div className="panel">Database not configured.</div></div>);

  const today = torontoToday();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp?.to || '') ? sp.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp?.from || '') ? sp.from : shift(to, -13);
  const r = await dailyPnl({ from, to });
  const latest = r.rows[r.rows.length - 1];

  return (
    <div>
      <AdminNav active="daily-pnl" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Daily profit &amp; loss</h1>
        <p className="hint">
          Product profit + delivery income, less delivery costs, staff wages and overhead. Everything is
          pre-tax. A day is a Toronto day. <a href="/admin/costs">Edit the cost list →</a>{' '}
          <a href="/admin/team-clock">Team hours →</a>
        </p>
        <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 16px' }}>
          <label>From <input type="date" name="from" defaultValue={r.from} /></label>
          <label>To <input type="date" name="to" defaultValue={r.to} /></label>
          <button className="dash-filter active" type="submit">Show</button>
          <a className="dash-filter" href={`?from=${today}&to=${today}`}>Today</a>
          <a className="dash-filter" href={`?from=${shift(today, -1)}&to=${shift(today, -1)}`}>Yesterday</a>
          <a className="dash-filter" href={`?from=${shift(today, -6)}&to=${today}`}>7 days</a>
          <a className="dash-filter" href={`?from=${today.slice(0, 7)}-01&to=${today}`}>This month</a>
        </form>

        {latest && (
          <div style={{ border: `2px solid ${latest.net >= 0 ? 'var(--ok)' : 'var(--danger)'}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{label(latest.day)}{latest.day === today ? ' (so far today)' : ''}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: latest.net >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {latest.net >= 0 ? 'Made ' : 'Lost '}{money(Math.abs(latest.net))}
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              Earned {money(latest.income)} ({money(latest.productProfit)} product profit + {money(latest.deliveryIncome)} deliveries)
              · Costs {money(latest.cost)} ({money(latest.deliveryCost)} delivery + {money(latest.staffWages)} staff + {money(latest.overhead)} overhead)
            </div>
          </div>
        )}

        {r.warnings.length > 0 && (
          <div style={{ background: 'var(--warnbg)', color: 'var(--warn)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>
            <b>Check before trusting these numbers</b>
            <ul style={{ margin: '6px 0 0 18px' }}>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div className="table-wrap"><table className="admin">
          <thead><tr>
            <th>Day</th><th style={{ textAlign: 'right' }}>Product profit</th><th style={{ textAlign: 'right' }}>Deliveries in</th>
            <th style={{ textAlign: 'right' }}>Delivery costs</th><th style={{ textAlign: 'right' }}>Staff wages</th>
            <th style={{ textAlign: 'right' }}>Overhead</th><th style={{ textAlign: 'right' }}>Net</th><th></th>
          </tr></thead>
          <tbody>
            {[...r.rows].reverse().map((d) => (
              <tr key={d.day}>
                <td>{label(d.day)}</td>
                <td style={{ textAlign: 'right' }}>{money(d.productProfit)}</td>
                <td style={{ textAlign: 'right' }}>{money(d.deliveryIncome)}</td>
                <td style={{ textAlign: 'right' }}>{signed(-d.deliveryCost)}</td>
                <td style={{ textAlign: 'right' }} title={`${d.staffHours}h`}>{signed(-d.staffWages)}</td>
                <td style={{ textAlign: 'right' }}>{signed(-d.overhead)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: d.net >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(d.net)}</td>
                <td>{d.net >= 0 ? 'Made' : 'Lost'}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}>
              <td>Total</td>
              <td style={{ textAlign: 'right' }}>{money(r.totals.productProfit)}</td>
              <td style={{ textAlign: 'right' }}>{money(r.totals.deliveryIncome)}</td>
              <td style={{ textAlign: 'right' }}>{signed(-r.totals.deliveryCost)}</td>
              <td style={{ textAlign: 'right' }}>{signed(-r.totals.staffWages)}</td>
              <td style={{ textAlign: 'right' }}>{signed(-r.totals.overhead)}</td>
              <td style={{ textAlign: 'right', color: r.totals.net >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(r.totals.net)}</td>
              <td>{r.totals.daysMade} made · {r.totals.daysLost} lost</td>
            </tr>
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
