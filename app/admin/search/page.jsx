import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { money, STATUS_LABELS } from '../../../lib/constants';
import { searchAll } from '../../../lib/search';
import { linkToken } from '../../../lib/links';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const pillClass = (s) => (
  ['delivered', 'paid', 'converted', 'accepted', 'confirmed', 'ready'].includes(s) ? 'ok'
    : ['open', 'pending_payment', 'out_for_delivery'].includes(s) ? 'warn' : 'sold'
);
const label = (s) => STATUS_LABELS[s] || String(s || '').replace(/_/g, ' ');

function Section({ title, rows, render }) {
  if (!rows.length) return null;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>{title} ({rows.length})</h2>
      <div className="table-wrap"><table className="admin">
        <tbody>{rows.map(render)}</tbody>
      </table></div>
    </div>
  );
}

export default async function AdminSearchPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/search');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  const q = String(searchParams?.q || '').slice(0, 100);
  let results = { customers: [], orders: [], invoices: [], quotes: [] };
  let error = '';
  if (hasDb() && q.trim().length >= 2) {
    try { results = await searchAll(q); } catch (e) { console.error('admin search failed', e.message); error = 'Search failed — try again.'; }
  }
  const total = results.customers.length + results.orders.length + results.invoices.length + results.quotes.length;

  return (
    <div>
      <AdminNav active="search" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Search everything</h1>
      <form action="/admin/search" style={{ marginBottom: 16 }}>
        <input name="q" defaultValue={q} autoFocus placeholder="Customer name, email, phone, or a BB- / INV- / Q- number…" style={{ maxWidth: 480 }} />
      </form>
      {error && <div className="error-box">{error}</div>}
      {q.trim().length >= 2 && !error && total === 0 && (
        <div className="panel" style={{ color: 'var(--muted)' }}>Nothing matches “{q}” across customers, orders, invoices, or quotes.</div>
      )}
      {q.trim().length > 0 && q.trim().length < 2 && (
        <div className="panel" style={{ color: 'var(--muted)' }}>Type at least 2 characters.</div>
      )}

      <Section title="Customers" rows={results.customers} render={(c) => (
        <tr key={`c${c.id}`}>
          <td><a href={`/admin/customers/${c.id}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{c.name || c.email}</a></td>
          <td>{c.email}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.phone || ''}</div></td>
          <td>{c.orders} orders</td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.spent)}</td>
          <td style={{ color: 'var(--muted)', fontSize: 13 }}>last {fmtDate(c.lastOrder)}</td>
        </tr>
      )} />

      <Section title="Orders" rows={results.orders} render={(r) => (
        <tr key={`o${r.id}`}>
          <td>
            <a href={`/order/${encodeURIComponent(r.number)}?t=${linkToken('order', r.number)}`} target="_blank" style={{ fontWeight: 700, textDecoration: 'underline' }}>{r.number}</a>
            <span style={{ marginLeft: 8, fontSize: 12 }}><a href={`/admin/orders/${encodeURIComponent(r.number)}/edit`} style={{ textDecoration: 'underline' }}>edit</a></span>
          </td>
          <td>{r.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div></td>
          <td><span className={'pill ' + pillClass(r.status)}>{label(r.status)}</span></td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.total)}</td>
          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtDate(r.createdAt)}</td>
        </tr>
      )} />

      <Section title="Invoices" rows={results.invoices} render={(r) => (
        <tr key={`i${r.id}`}>
          <td><a href={`/invoice/${encodeURIComponent(r.number)}?t=${linkToken('invoice', r.number)}`} target="_blank" style={{ fontWeight: 700, textDecoration: 'underline' }}>{r.number}</a></td>
          <td>{r.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div></td>
          <td><span className={'pill ' + pillClass(r.status)}>{r.status}</span></td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.total)}</td>
          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtDate(r.createdAt)}</td>
        </tr>
      )} />

      <Section title="Quotes" rows={results.quotes} render={(r) => (
        <tr key={`q${r.id}`}>
          <td><a href={`/quote/${encodeURIComponent(r.number)}?t=${linkToken('quote', r.number)}`} target="_blank" style={{ fontWeight: 700, textDecoration: 'underline' }}>{r.number}</a></td>
          <td>{r.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div></td>
          <td><span className={'pill ' + pillClass(r.status)}>{r.status}</span></td>
          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.total)}</td>
          <td style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtDate(r.createdAt)}</td>
        </tr>
      )} />
    </div>
  );
}
