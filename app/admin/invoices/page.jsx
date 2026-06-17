import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { money } from '../../../lib/constants';
import { stripeConfigured } from '../../../lib/stripe';
import { listInvoices } from '../../../lib/invoices';
import AdminNav from '../../../components/AdminNav';
import InvoiceForm from '../../../components/InvoiceForm';
import MarkPaidControl from '../../../components/MarkPaidControl';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoices — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const statusClass = (s) => (s === 'paid' ? 'ok' : s === 'open' || s === 'draft' ? 'warn' : s === 'void' || s === 'uncollectible' ? 'sold' : 'warn');

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/invoices');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }

  let invoices = [];
  let loadError = '';
  if (stripeConfigured()) {
    try { invoices = await listInvoices(25); }
    catch (e) { loadError = e?.message || 'Could not load invoices from Stripe.'; }
  }

  return (
    <div>
      <AdminNav active="invoices" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Invoices</h1>

      {!stripeConfigured() && (
        <div className="error-box">Stripe isn&apos;t configured yet (set <code>STRIPE_SECRET_KEY</code>). Invoicing needs it.</div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>New invoice</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Creates a hosted Stripe invoice and emails the customer a pay link. Good for offline/custom sales.
        </p>
        <InvoiceForm />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Recent invoices</h2>
        {loadError && (
          <div className="error-box" style={{ marginBottom: 10 }}>
            {loadError}
            <div className="hint" style={{ marginTop: 6 }}>
              If this mentions permissions, your Stripe key needs <b>Invoices / Customers / Invoice Items</b> access.
            </div>
          </div>
        )}
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th>Paid via / action</th><th></th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No invoices yet.</td></tr>}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 700 }}>{inv.number}</td>
                <td>{inv.email || '—'}</td>
                <td><span className={'pill ' + statusClass(inv.status)}>{inv.status}</span></td>
                <td>{fmtDate(inv.created)}</td>
                <td style={{ textAlign: 'right' }}>{money(inv.total)}</td>
                <td>
                  {inv.status === 'open'
                    ? <MarkPaidControl invoiceId={inv.id} />
                    : (inv.method || (inv.status === 'paid' ? 'Card (online)' : '—'))}
                </td>
                <td>{inv.hostedUrl ? <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>View</a> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
