import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { money } from '../../../../lib/constants';
import { getCustomerProfile } from '../../../../lib/customers';
import { linkToken } from '../../../../lib/links';
import DashboardShell from '../../../../components/DashboardShell';
import CustomerEditor from '../../../../components/CustomerEditor';
import { Kpi } from '../../../../components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customer — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const pillClass = (s) => (
  ['delivered', 'paid', 'converted', 'accepted', 'confirmed', 'ready'].includes(s) ? 'ok'
    : ['open', 'pending_payment', 'out_for_delivery'].includes(s) ? 'warn' : 'sold'
);
const label = (s) => String(s || '').replace(/_/g, ' ');

export default async function CustomerProfilePage({ params }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/customers/${params.id}`);
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<DashboardShell active="customers"><div className="panel">Database not configured.</div></DashboardShell>);

  let c = null;
  try { c = await getCustomerProfile(params.id); } catch (e) { console.error('customer profile load failed', e.message); }
  if (!c) {
    return (
      <DashboardShell active="customers">
        <div className="panel">Customer not found. <a href="/admin/customers" style={{ textDecoration: 'underline' }}>← Back to customers</a></div>
      </DashboardShell>
    );
  }

  const { orders, invoices, quotes } = c.history;
  const avgOrder = c.orders > 0 ? c.spent / c.orders : 0;

  return (
    <DashboardShell active="customers">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 14px' }}>
        <h1 style={{ margin: 0 }}>
          {c.name || c.email}
          {c.memberStatus === 'approved' && <span className="pill ok" style={{ marginLeft: 8, verticalAlign: 'middle' }}>member</span>}
          {!c.hasAccount && <span className="pill" style={{ marginLeft: 8, verticalAlign: 'middle' }}>no account</span>}
        </h1>
        <a href="/admin/customers" className="hint" style={{ margin: 0, textDecoration: 'underline' }}>← All customers</a>
      </div>

      <div className="dash-kpis">
        <Kpi label="Total spent" value={money(c.spent)} sub="completed sales" />
        <Kpi label="Orders" value={c.orders} sub={c.lastOrder ? `last ${fmtDate(c.lastOrder)}` : 'no sales yet'} />
        <Kpi label="Avg order" value={c.orders ? money(avgOrder) : '—'} sub="per sale" />
        <Kpi label="Customer since" value={fmtDate(c.createdAt)} sub={c.business || (c.hasAccount ? 'has an account' : 'guest / invoiced')} />
      </div>

      <div className="dash-2col">
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Contact</h2>
          <CustomerEditor customer={c} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Quotes ({quotes.length})</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Quote</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {quotes.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No quotes.</td></tr>}
              {quotes.map((x) => (
                <tr key={x.id}>
                  <td style={{ fontWeight: 700 }}>
                    <a href={`/quote/${encodeURIComponent(x.number)}?t=${linkToken('quote', x.number)}`} target="_blank" style={{ textDecoration: 'underline' }}>{x.number}</a>
                  </td>
                  <td><span className={'pill ' + pillClass(x.status)}>{label(x.status)}</span></td>
                  <td>{fmtDate(x.createdAt)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(x.total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Orders ({orders.length})</h2>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Order</th><th>Status</th><th>Date</th><th>Items</th><th>Fulfilment</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No orders.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id}>
                <td style={{ fontWeight: 700 }}>
                  <a href={`/order/${encodeURIComponent(o.number)}?t=${linkToken('order', o.number)}`} target="_blank" style={{ textDecoration: 'underline' }}>{o.number}</a>
                </td>
                <td><span className={'pill ' + pillClass(o.status)}>{label(o.status)}</span></td>
                <td>{fmtDate(o.createdAt)}</td>
                <td style={{ maxWidth: 420 }}>{(o.items || []).map((it) => it.title).join(' · ') || '—'}</td>
                <td>{o.deliveryMethod || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Invoices ({invoices.length})</h2>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Invoice</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No invoices.</td></tr>}
            {invoices.map((x) => (
              <tr key={x.id}>
                <td style={{ fontWeight: 700 }}>
                  <a href={`/invoice/${encodeURIComponent(x.number)}?t=${linkToken('invoice', x.number)}`} target="_blank" style={{ textDecoration: 'underline' }}>{x.number}</a>
                </td>
                <td>
                  <span className={'pill ' + pillClass(x.status)}>{x.status}</span>
                  {x.refunded > 0 && x.status === 'paid' && <span className="pill sold" style={{ marginLeft: 4 }}>−{money(x.refunded)}</span>}
                </td>
                <td>{fmtDate(x.createdAt)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(x.total)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </DashboardShell>
  );
}
