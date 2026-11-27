import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { cashSplit } from '../../../lib/cash-split';
import { money, torontoToday } from '../../../lib/constants';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Where the money goes — Bargain Bay' };

const shift = (iso, d) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const label = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const signed = (v) => (v < 0 ? `(${money(-v)})` : money(v));
const R = { textAlign: 'right' };

export default async function CashSplitPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/cash-split');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="cash-split" /><div className="panel">Database not configured.</div></div>);

  const today = torontoToday();
  const r = await cashSplit({ from: sp?.from, to: sp?.to });
  const t = r.total;
  const eating = t.profit < 0;
  const free = r.bankroll && r.restock ? r.bankroll.total - Math.max(0, r.restock.toPutBack) : null;

  return (
    <div>
      <AdminNav active="cash-split" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Where the money goes</h1>
        <p className="hint">
          Every dollar the business takes in, split into four piles that add back to the sales: <b>product</b> to put back
          into stock, <b>labour</b> to set aside for the day it was worked, <b>running costs</b>, and <b>profit</b>.
          Before HST. A day is a Toronto day. Sales are counted on the invoice date, the same as the <a href="/admin/daily-pnl">Daily P&amp;L</a>.
        </p>
        <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 16px' }}>
          <label>Since <input type="date" name="from" defaultValue={r.from} /></label>
          <label>To <input type="date" name="to" defaultValue={r.to} /></label>
          <button className="dash-filter active" type="submit">Show</button>
          <a className="dash-filter" href={`?from=${today}&to=${today}`}>Today</a>
          <a className="dash-filter" href={`?from=${shift(today, -6)}&to=${today}`}>7 days</a>
          <a className="dash-filter" href={`?from=${today.slice(0, 7)}-01&to=${today}`}>This month</a>
        </form>

        <div style={{ border: `2px solid ${eating ? 'var(--danger)' : 'var(--ok)'}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{label(r.from)} – {label(r.to)} · running total</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: eating ? 'var(--danger)' : 'var(--ok)' }}>
            {eating ? `Eating into the bankroll by ${money(-t.profit)}` : `Profit ${money(t.profit)}`}
          </div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            Of {money(t.sales)} taken in: <b>{money(t.product)}</b> back into product · <b>{money(t.labour)}</b> labour · {money(t.running)} running costs · <b>{signed(t.profit)}</b> profit
            {r.share.product != null && <> ({r.share.product}% / {r.share.labour}% / {r.share.running}% / {r.share.profit}%)</>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div className="hint">Put back into product</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{money(t.product)}</div>
            {r.restock
              ? <div className="hint">Bought since: {money(r.restock.bought)} · <b style={{ color: r.restock.toPutBack > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                  {r.restock.toPutBack > 0 ? `${money(r.restock.toPutBack)} still to put back` : `stock up ${money(-r.restock.toPutBack)}`}</b></div>
              : <div className="hint">Stock bought could not be read.</div>}
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div className="hint">Set aside for labour</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{money(t.labour)}</div>
            <div className="hint">Staff clock + driver pay and hours, for the days worked</div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div className="hint">Running costs</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{money(t.running)}</div>
            <div className="hint">Rent and bills, truck, fuel</div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div className="hint">Profit</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: eating ? 'var(--danger)' : 'var(--ok)' }}>{signed(t.profit)}</div>
            <div className="hint">{r.daysLost} day{r.daysLost === 1 ? '' : 's'} lost money</div>
          </div>
        </div>

        {r.bankroll && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, marginBottom: 16, fontSize: 14 }}>
            <b>Bankroll today: {money(r.bankroll.total)}</b> <a href="/admin/financial">(see it →)</a>
            {free != null && <> · after the {money(Math.max(0, r.restock.toPutBack))} still owed to stock it is <b style={{ color: free < 0 ? 'var(--danger)' : undefined }}>{signed(free)}</b>.
              {free < 0 && ' You do not have enough to put the sold stock back.'}</>}
            <div className="hint">Labour and running costs are not taken off here, because wages paid and bills paid are not tracked against these days.</div>
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
            <th>Day</th><th style={R}>Sales</th><th style={R}>Product</th><th style={R}>Labour</th><th style={R}>Running</th><th style={R}>Profit</th>
            <th style={R}>Product so far</th><th style={R}>Labour so far</th><th style={R}>Profit so far</th>
          </tr></thead>
          <tbody>
            {[...r.rows].reverse().map((d) => (
              <tr key={d.day}>
                <td>{label(d.day)}</td>
                <td style={R}>{money(d.sales)}</td><td style={R}>{money(d.product)}</td><td style={R}>{money(d.labour)}</td><td style={R}>{money(d.running)}</td>
                <td style={{ ...R, fontWeight: 700, color: d.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(d.profit)}</td>
                <td style={R}>{money(d.run.product)}</td><td style={R}>{money(d.run.labour)}</td>
                <td style={{ ...R, color: d.run.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{signed(d.run.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="hint">Product is the cost of the units sold (consigned units at their pre-tax cost, as the Daily P&amp;L counts them). Units sold with no cost on file are counted as nothing, so product is too low until <a href="/admin/cost-fix">their costs are entered</a>.
          {r.vendorTax > 0 && <> Drop-off vendors are paid with tax included, so putting their units back takes <b>{money(r.vendorTax)}</b> more than the product figure here; the Sales dashboard&apos;s &quot;keep aside&quot; includes it.</>}</p>
      </div>
    </div>
  );
}
