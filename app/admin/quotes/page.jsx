import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { money } from '../../../lib/constants';
import { hasDb } from '../../../lib/db';
import { listQuotes, getQuoteForBuilder } from '../../../lib/quotes';
import { customerContacts } from '../../../lib/analytics';
import { getAll } from '../../../lib/inventory';
import AdminNav from '../../../components/AdminNav';
import QuoteBuilder from '../../../components/QuoteBuilder';
import QuoteActions from '../../../components/QuoteActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quotes — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const statusClass = (s) => (s === 'converted' || s === 'accepted' ? 'ok' : s === 'open' ? 'warn' : 'sold');

export default async function QuotesPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/quotes');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }

  let quotes = [];
  let loadError = '';
  if (hasDb()) {
    try { quotes = await listQuotes(25); }
    catch (e) { loadError = e?.message || 'Could not load quotes.'; }
  }

  let customers = [];
  try {
    customers = (await customerContacts()).map((c) => ({
      name: c.name, email: c.email, phone: c.phone,
      search: `${c.name} ${c.email} ${c.phone}`.toLowerCase()
    }));
  } catch { customers = []; }

  let initial = null;
  if (searchParams?.from) {
    try { initial = await getQuoteForBuilder(searchParams.from); } catch { initial = null; }
  }

  let inventory = [];
  try {
    inventory = (await getAll()).map((u) => ({
      id: u.id,
      description: `${u.title || `${u.make} ${u.model}`} (${u.id})`,
      price: Number(u.price) || 0,
      retail: Number(u.compareAt) || 0,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.id || ''}`.toLowerCase()
    }));
  } catch { inventory = []; }

  return (
    <div>
      <AdminNav active="quotes" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Quotes</h1>

      {!hasDb() && (
        <div className="error-box">Database isn&apos;t configured (set <code>POSTGRES_URL</code>). Quotes need it.</div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>{initial ? 'Price & send this request' : 'New package quote'}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Build a bundle, apply a discount, and email the customer a shareable quote. Nothing is reserved —
          the units stay live until you convert the quote to an invoice.
        </p>
        <QuoteBuilder inventory={inventory} customers={customers} initial={initial} />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Recent quotes</h2>
        {loadError && <div className="error-box" style={{ marginBottom: 10 }}>{loadError}</div>}
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Quote</th><th>Customer</th><th>Status</th><th>Valid until</th><th style={{ textAlign: 'right' }}>Total</th><th>Action</th><th></th></tr></thead>
          <tbody>
            {quotes.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No quotes yet.</td></tr>}
            {quotes.map((qt) => (
              <tr key={qt.id}>
                <td style={{ fontWeight: 700 }}>
                  {qt.number}{qt.freeDelivery ? <span title="Free delivery"> 🚚</span> : ''}
                  {qt.source === 'customer' && <span className="pill warn" style={{ marginLeft: 6, fontSize: 11 }}>request</span>}
                </td>
                <td>{qt.name ? `${qt.name} · ` : ''}{qt.email || '—'}</td>
                <td><span className={'pill ' + statusClass(qt.status)}>{qt.status}</span></td>
                <td>{qt.status === 'open' ? fmtDate(qt.expires) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{money(qt.total)}</td>
                <td>
                  {qt.source === 'customer' && qt.status === 'open'
                    ? <a className="btn accent" style={{ padding: '5px 10px' }} href={`/admin/quotes?from=${qt.id}`}>Price &amp; send →</a>
                    : <QuoteActions quoteId={qt.id} status={qt.status} invoiceUrl={qt.convertedInvoiceId ? `/admin/invoices` : null} />}
                </td>
                <td>{qt.hostedUrl ? <a href={qt.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>View</a> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
