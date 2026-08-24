import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { money } from '../../../lib/constants';
import { hasDb } from '../../../lib/db';
import { listInvoices, listInvoiceAuthors, INVOICE_FILTERS } from '../../../lib/invoices';
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

const PAGE_SIZE = 25;

export default async function InvoicesPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/invoices');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }

  // Search / filter / paging state comes from the URL, so a result set is
  // linkable and survives a refresh (and the form below is a plain GET).
  const q = String(sp?.q || '').slice(0, 100);
  const status = INVOICE_FILTERS[String(sp?.status || '')] !== undefined ? String(sp?.status || '') : '';
  const rep = String(sp?.rep || '').slice(0, 200);
  const page = Math.max(parseInt(sp?.page, 10) || 1, 1);
  const searching = !!(q.trim() || status || rep);

  // Everyone who has raised an invoice, for the "raised by" filter.
  let authors = [];
  try { authors = await listInvoiceAuthors(); } catch { authors = []; }
  const repLabel = rep === 'unattributed'
    ? 'no rep recorded'
    : (authors.find((a) => a.email === rep)?.name || rep);

  let invoices = [];
  let matchCount = 0;
  let owing = 0;
  let hasMore = false;
  let loadError = '';
  if (hasDb()) {
    try {
      const res = await listInvoices({ q, status, rep, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      invoices = res.invoices; matchCount = res.total; owing = res.owing; hasMore = res.hasMore;
    } catch (e) { loadError = e?.message || 'Could not load invoices.'; }
  }
  const pageUrl = (n) => {
    const u = new URLSearchParams();
    if (q) u.set('q', q);
    if (status) u.set('status', status);
    if (rep) u.set('rep', rep);
    if (n > 1) u.set('page', String(n));
    const qs = u.toString();
    return '/admin/invoices' + (qs ? `?${qs}` : '');
  };

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
          Good for offline / custom / wholesale sales. It gets a <b>BB- order number and counts as revenue
          straight away</b>, dated to the invoice — take a deposit now and collect the balance on delivery.
          Mark it paid here when the rest of the money lands.
        </p>
        <InvoiceForm inventory={inventory} customers={customers} hideCost={!isAdmin(session)} />
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>
            {searching ? 'Invoice search' : 'Recent invoices'}
          </h2>
          <SyncDashboardButton />
        </div>

        {/* Plain GET form — searches EVERY invoice, not just the recent page. */}
        <form className="inv-search" action="/admin/invoices">
          <input name="q" type="search" defaultValue={q} placeholder="INV- or BB- number, customer, phone, or an appliance / SKU on the invoice…" />
          <select name="status" defaultValue={status}>
            {Object.entries(INVOICE_FILTERS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {authors.length > 0 && (
            <select name="rep" defaultValue={rep} title="Filter by the person who raised the invoice">
              <option value="">Anyone</option>
              {authors.map((a) => <option key={a.email} value={a.email}>Raised by {a.name} ({a.count})</option>)}
              <option value="unattributed">No rep recorded</option>
            </select>
          )}
          <button className="btn accent" type="submit">Search</button>
          {searching && <a className="btn" href="/admin/invoices">Clear</a>}
        </form>

        {searching ? (
          <p className="hint" style={{ marginTop: 8 }}>
            {matchCount === 0
              ? <>Nothing matches{q ? <> “{q}”</> : ''}{status ? <> in <b>{INVOICE_FILTERS[status]}</b></> : ''}.</>
              : <><b>{matchCount}</b> invoice{matchCount === 1 ? '' : 's'} match{matchCount === 1 ? 'es' : ''}
                {rep && <> · raised by <b>{repLabel}</b></>}
                {owing > 0 && <> · <b>{money(owing)}</b> still owing across them</>}
                {matchCount > PAGE_SIZE && <> · showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + invoices.length}</>}</>}
          </p>
        ) : (
          <p className="hint" style={{ marginTop: 6 }}>
            The 25 most recent — use the box above to search every invoice ever raised, including older part-paid ones.
            Marking an invoice paid always counts it as collected automatically, and a nightly job re-checks for any that
            slipped. The Sync button is just an optional <i>fix-it-now</i> for older invoices.
          </p>
        )}
        {loadError && (
          <div className="error-box" style={{ marginBottom: 10 }}>{loadError}</div>
        )}
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Raised by</th><th>Status</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th>Paid via / action</th><th></th></tr></thead>
          <tbody>
            {invoices.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>
                {searching ? 'No invoices match that search.' : 'No invoices yet.'}
              </td></tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 700 }}>
                  {inv.number}
                  {inv.orderNumber && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}
                         title="Fulfilment order for this invoice — searchable above">{inv.orderNumber}</div>
                  )}
                </td>
                <td>{inv.name || inv.email || '—'}{inv.name && inv.email && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{inv.email}</div>
                )}</td>
                <td>
                  {inv.createdByName
                    ? <a href={`/admin/invoices?rep=${encodeURIComponent(inv.createdBy || '')}`}
                         title={`Show every invoice raised by ${inv.createdByName}`}
                         style={{ textDecoration: 'underline' }}>{inv.createdByName}</a>
                    : <span style={{ color: 'var(--muted)' }} title="Raised before invoices recorded who created them">—</span>}
                </td>
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
                    ? <MarkPaidControl invoiceId={inv.id} balance={inv.balance ?? inv.total} payments={inv.payments || []} />
                    : (inv.method || (inv.status === 'paid' ? 'Paid' : inv.status === 'refunded' ? 'Refunded' : '—'))}
                </td>
                <td><InvoiceActions invoice={inv} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {(page > 1 || hasMore) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            {page > 1 ? <a className="btn" href={pageUrl(page - 1)}>← Newer</a> : <span />}
            <span className="hint" style={{ margin: 0 }}>Page {page}</span>
            {hasMore && <a className="btn" href={pageUrl(page + 1)}>Older →</a>}
          </div>
        )}
      </div>
    </div>
  );
}
