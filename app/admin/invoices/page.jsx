import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { money } from '../../../lib/constants';
import { hasDb } from '../../../lib/db';
import { listInvoices } from '../../../lib/invoices';
import { contactsForAutofill } from '../../../lib/customers';
import { getAll } from '../../../lib/inventory';
import AdminNav from '../../../components/AdminNav';
import InvoiceForm from '../../../components/InvoiceForm';
import MarkPaidControl from '../../../components/MarkPaidControl';
import InvoiceActions from '../../../components/InvoiceActions';
import SyncDashboardButton from '../../../components/SyncDashboardButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoices — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const statusClass = (s) => (s === 'paid' ? 'ok' : s === 'open' || s === 'partial' || s === 'draft' ? 'warn' : s === 'void' || s === 'refunded' || s === 'uncollectible' ? 'sold' : 'warn');

export default async function InvoicesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/invoices');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }

  let invoices = [];
  let loadError = '';
  if (hasDb()) {
    try { invoices = await listInvoices(25); }
    catch (e) { loadError = e?.message || 'Could not load invoices.'; }
  }

  let customers = [];
  try {
    customers = (await contactsForAutofill()).map((c) => ({
      name: c.name, email: c.email, phone: c.phone,
      address: c.address, city: c.city, postal: c.postal,
      search: `${c.name} ${c.email} ${c.phone}`.toLowerCase()
    }));
  } catch { customers = []; }

  let inventory = [];
  try {
    inventory = (await getAll()).map((u) => ({
      id: u.id,
      description: `${u.title || `${u.make} ${u.model}`} (${u.id})`,
      price: Number(u.price) || 0,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase()
    }));
  } catch { inventory = []; }

  return (
    <div>
      <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Invoices</h1>

      {!hasDb() && (
        <div className="error-box">Database isn&apos;t configured (set <code>POSTGRES_URL</code>). Invoicing needs it.</div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>New invoice</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Emails the customer an itemized invoice to pay by Interac e-transfer (auto-deposit) or in person.
          Good for offline / custom / wholesale sales. Mark it paid here when the money lands.
        </p>
        <InvoiceForm inventory={inventory} customers={customers} hideCost={!isAdmin(session)} />
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Recent invoices</h2>
          <SyncDashboardButton />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Marking an invoice paid now always counts it as revenue automatically, and a nightly job re-checks for any that
          slipped — you don&apos;t need to do anything. This button is just an optional <i>fix-it-now</i> for older invoices.
        </p>
        {loadError && (
          <div className="error-box" style={{ marginBottom: 10 }}>{loadError}</div>
        )}
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th>Paid via / action</th><th></th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No invoices yet.</td></tr>}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 700 }}>{inv.number}</td>
                <td>{inv.email || '—'}</td>
                <td>
                  <span className={'pill ' + statusClass(inv.status)}>{inv.status}</span>
                  {inv.status === 'paid' && inv.refundedTotal > 0 && (
                    <span className="pill sold" style={{ marginLeft: 4 }} title={`${money(inv.refundedTotal)} of this invoice has been refunded`}>
                      −{money(inv.refundedTotal)}
                    </span>
                  )}
                  {inv.status === 'partial' && (
                    <span className="pill ok" style={{ marginLeft: 4 }} title={`${money(inv.amountPaid)} received so far — ${money(inv.balance)} still owing`}>
                      {money(inv.amountPaid)} in
                    </span>
                  )}
                </td>
                <td>{fmtDate(inv.created)}</td>
                <td style={{ textAlign: 'right' }}>
                  {money(inv.total)}
                  {inv.status === 'partial' && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>owing {money(inv.balance)}</div>
                  )}
                </td>
                <td>
                  {inv.status === 'open' || inv.status === 'partial'
                    ? <MarkPaidControl invoiceId={inv.id} balance={inv.balance ?? inv.total} />
                    : (inv.method || (inv.status === 'paid' ? 'Paid' : inv.status === 'refunded' ? 'Refunded' : '—'))}
                </td>
                <td><InvoiceActions invoice={inv} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
