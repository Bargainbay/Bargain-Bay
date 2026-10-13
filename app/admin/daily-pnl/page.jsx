import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { dailyPnl } from '../../../lib/daily-pnl';
import { daySales } from '../../../lib/day-sales';
import { zeroCostLines, blankCostCount } from '../../../lib/cost-audit';
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
  const [r, ds, zc] = await Promise.all([dailyPnl({ from, to }), daySales(to), zeroCostLines().catch(() => null)]);
  const blank = await blankCostCount().catch(() => 0);
  const latest = r.rows[r.rows.length - 1];

  return (
    <div>
      <AdminNav active="daily-pnl" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Daily profit &amp; loss</h1>
        <p className="hint">
          Product profit + delivery income, less delivery costs, staff wages and overhead. Everything is
          pre-tax. A day is a Toronto day. <a href="/admin/costs">Edit the cost list →</a>{' '}
          <a href="/admin/team-clock">Team hours →</a>{' '}
          <a href="/admin/cost-fix">Fix missing costs →</a>
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


        <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <b style={{ fontSize: 16 }}>Sales for {label(ds.day)}{ds.day === today ? ' (so far today)' : ''}</b>
            <span className="hint">All amounts before HST unless marked. Cost is the products only.</span>
          </div>
          <div className="table-wrap"><table className="admin" style={{ marginTop: 8 }}>
            <thead><tr><th></th><th style={{ textAlign: 'right' }}>Invoices created</th><th style={{ textAlign: 'right' }}>Invoices paid</th></tr></thead>
            <tbody>
              <tr><td>Invoices</td><td style={{ textAlign: 'right' }}>{ds.created.count}</td><td style={{ textAlign: 'right' }}>{ds.paid.count}</td></tr>
              <tr><td>Total sales</td><td style={{ textAlign: 'right' }}>{money(ds.created.sales)}</td><td style={{ textAlign: 'right' }}>{money(ds.paid.sales)}</td></tr>
              <tr><td className="hint">…with HST</td><td style={{ textAlign: 'right' }} className="hint">{money(ds.created.withTax)}</td><td style={{ textAlign: 'right' }} className="hint">{money(ds.paid.withTax)}</td></tr>
              <tr><td>Cost of products</td><td style={{ textAlign: 'right' }}>{signed(-ds.created.cost)}</td><td style={{ textAlign: 'right' }}>{signed(-ds.paid.cost)}</td></tr>
              <tr><td className="hint">Services in the total (delivery, install…)</td><td style={{ textAlign: 'right' }} className="hint">{money(ds.created.serviceSales)}</td><td style={{ textAlign: 'right' }} className="hint">{money(ds.paid.serviceSales)}</td></tr>
              <tr><td className="hint" style={{ color: (ds.created.unknownSales + ds.paid.unknownSales) > 0 ? 'var(--warn)' : undefined }}>Sold, cost unknown (not in the profit below)</td>
                <td style={{ textAlign: 'right', color: ds.created.unknownSales > 0 ? 'var(--warn)' : undefined }} className="hint">{money(ds.created.unknownSales)}</td>
                <td style={{ textAlign: 'right', color: ds.paid.unknownSales > 0 ? 'var(--warn)' : undefined }} className="hint">{money(ds.paid.unknownSales)}</td></tr>
              <tr style={{ fontWeight: 800 }}><td>Product profit <span className="hint" style={{ fontWeight: 400 }}>(units with a known cost)</span></td>
                <td style={{ textAlign: 'right', color: ds.created.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(ds.created.profit)}</td>
                <td style={{ textAlign: 'right', color: ds.paid.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(ds.paid.profit)}</td></tr>
            </tbody>
          </table></div>
          <p className="hint" style={{ marginBottom: 0 }}>
            Cash actually received today (deposits and balances): <b>{money(ds.cashReceived)}</b> across {ds.cashPayments} payment{ds.cashPayments === 1 ? '' : 's'}.
            {' '}Product profit is before staff, delivery and overhead costs, which are in the daily P&amp;L below, and uses the same rule as it.
            {(ds.created.missingCost + ds.paid.missingCost) > 0 && <b style={{ color: 'var(--warn)' }}> Some units have no cost on file: they are left out of the profit (shown as &quot;cost unknown&quot;), not counted as pure profit. <a href="/admin/cost-fix">Enter the costs →</a></b>}
          </p>
          {[['Invoices created', ds.created.rows], ['Invoices paid', ds.paid.rows]].map(([title, rows]) => rows.length > 0 && (
            <details key={title} style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{title}: {rows.length}</summary>
              <div className="table-wrap"><table className="admin">
                <thead><tr><th>Invoice</th><th>Customer</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Product profit</th><th>Status</th></tr></thead>
                <tbody>{rows.map((x) => (
                  <tr key={x.id}><td>{x.number}</td><td>{x.customer}</td><td style={{ textAlign: 'right' }}>{money(x.sales)}</td>
                    <td style={{ textAlign: 'right' }}>{money(x.cost)}{x.missing ? ' ⚠' : ''}</td>
                    <td style={{ textAlign: 'right' }}>{x.missing ? <span className="hint">cost unknown</span> : signed(x.profit)}</td><td>{x.status}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          ))}
        </div>

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

        {(zc?.summary?.lines > 0 || blank > 0) && (
          <div style={{ background: 'var(--warnbg)', color: 'var(--warn)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>
            <b>Some sold units have no cost counted.</b>{' '}
            {zc?.summary?.lines > 0 && <>{zc.summary.lines} are saved at $0, hiding {money(zc.summary.costLeftOut)} of real cost. </>}
            {blank > 0 && <>{blank} sold line{blank === 1 ? ' has' : 's have'} no cost at all (the tracker may have it). </>}
            <a href="/admin/cost-fix">Preview and fix →</a>
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
