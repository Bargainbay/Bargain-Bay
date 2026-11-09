import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { partnerReport, statementFor } from '../../../lib/referral-partners';
import { money, torontoToday } from '../../../lib/constants';
import PrintButton from '../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Commission statement — Bargain Bay', robots: { index: false } };

// A month of a partner's orders and payments, printable. Cut from the same report as the clients page.
export default async function StatementPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner/statement');
  const sp = (await searchParams) || {};
  const as = typeof sp.as === 'string' ? sp.as : '';
  const email = isAdmin(session) && as ? as : session.email;
  const report = hasDb() ? await partnerReport(email) : null;
  if (!report?.partner) return (<div className="narrow"><div className="panel"><p>Not a referral partner.</p></div></div>);
  const month = typeof sp.month === 'string' ? sp.month : torontoToday().slice(0, 7);
  const st = statementFor(report, month);
  const asq = as && isAdmin(session) ? `&as=${encodeURIComponent(as)}` : '';
  const d = new Date(`${st.month}-15T12:00:00`);
  const label = d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15).toISOString().slice(0, 7);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 15).toISOString().slice(0, 7);
  return (
    <div className="narrow" style={{ maxWidth: 900 }}>
      <div className="noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px', alignItems: 'center' }}>
        <a className="btn" href={`/partner${asq ? '?' + asq.slice(1) : ''}`}>← My clients</a>
        <a className="btn" href={`/partner/statement?month=${prev}${asq}`}>‹ Previous</a>
        <a className="btn" href={`/partner/statement?month=${next}${asq}`}>Next ›</a>
        <a className="btn" href={`/api/partner/statement?month=${st.month}${asq}`}>Download CSV</a>
        <PrintButton />
      </div>
      <h1 style={{ color: 'var(--charcoal)', marginTop: 0 }}>Commission statement — {label}</h1>
      <p className="hint">{report.partner.name || report.partner.email} · {report.partner.pct}% of profit</p>
      <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
        <thead><tr><th>Order</th><th>Date</th><th>Client</th><th>Items</th><th>Total (pre-tax)</th><th>Discount</th><th>Profit</th><th>Rate</th><th>Status</th><th>Commission</th></tr></thead>
        <tbody>
          {st.orders.length === 0 && <tr><td colSpan={10} className="hint">No orders this month.</td></tr>}
          {st.orders.map((o) => (<tr key={o.number}><td>{o.number}</td><td>{String(o.at || '').slice(0, 10)}</td><td>{o.client}</td><td>{o.items || '—'}</td>
            <td>{money(o.subtotal)}</td><td>{o.discount > 0 ? money(o.discount) : '—'}</td><td>{money(o.profit)}</td><td>{o.ratePct}%</td><td>{o.statusLabel}{o.earned ? '' : ' (pending)'}</td><td>{money(o.commission)}</td></tr>))}
        </tbody>
      </table></div>
      <h2 style={{ fontSize: 17 }}>Payments to you</h2>
      {st.payments.length === 0 ? <p className="hint">None this month.</p> : (
        <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
          <tbody>{st.payments.map((p) => (<tr key={p.id}><td>{p.paid_on}</td><td>{p.method || '—'}</td><td>{p.reference || '—'}</td><td>{money(p.amount)}</td></tr>))}</tbody>
        </table></div>
      )}
      <div className="panel" style={{ marginTop: 16, lineHeight: 1.8 }}>
        <div>Commission this month: <b>{money(st.totals.commission)}</b> (earned {money(st.totals.earned)})</div>
        <div>Paid to you this month: <b>{money(st.totals.paid)}</b></div>
        <div>Balance owed to you to date: <b>{money(st.balance)}</b></div>
      </div>
    </div>
  );
}
