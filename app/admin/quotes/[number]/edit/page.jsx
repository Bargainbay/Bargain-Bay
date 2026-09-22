import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getQuoteByNumber } from '../../../../../lib/quotes';
import { listLeadSenders } from '../../../../../lib/invoices';
import { contactsForAutofill } from '../../../../../lib/customers';
import { getAll } from '../../../../../lib/inventory';
import { stockForInvoicing } from '../../../../../lib/stock-reconcile';
import AdminNav from '../../../../../components/AdminNav';
import QuoteBuilder from '../../../../../components/QuoteBuilder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit quote — Bargain Bay' };

export default async function EditQuotePage({ params }) {
  const { number } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/quotes/${number}/edit`);
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const quote = await getQuoteByNumber(number).catch(() => null);
  if (!quote) return notFound();

  if (quote.status !== 'open') {
    return (
      <div>
        <AdminNav active="quotes" salesOnly={!isAdmin(session)} />
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Edit {quote.number}</h1>
        <div className="error-box">
          This quote is <b>{quote.status}</b> and can&apos;t be edited.{' '}
          {quote.status === 'accepted' ? 'The customer already said yes to these numbers — Convert it to an invoice, or Void it and send a fresh one.' : ''}
        </div>
        <p><a className="btn" href="/admin/quotes">← Back to quotes</a></p>
      </div>
    );
  }

  let customers = [];
  try {
    customers = (await contactsForAutofill()).map((c) => ({
      name: c.name, email: c.email, phone: c.phone,
      address: c.address, city: c.city, postal: c.postal,
      search: `${c.name} ${c.email} ${c.phone}`.toLowerCase()
    }));
  } catch { customers = []; }

  // Everything on the tracker that isn't sold — the same list the invoice form
  // offers. It used to be live website stock only, so a unit still in cleaning
  // or repair could not be picked and got typed instead, and a typed quote line
  // becomes a typed invoice line at conversion.
  let inventory = [];
  try {
    const catalog = await getAll().catch(() => []);
    // Retail (the "was" price a bundle discount is shown against) only exists
    // for a unit the website knows; a unit still in cleaning simply has none.
    const retailOf = new Map(catalog.map((u) => [String(u.id).toUpperCase(), Number(u.compareAt) || 0]));
    inventory = (await stockForInvoicing({ catalog }))
      .map((u) => ({ ...u, retail: retailOf.get(String(u.id).toUpperCase()) || 0 }));
  } catch { inventory = []; }

  const initial = {
    name: quote.name || '',
    email: quote.email || '',
    items: quote.items.map((it) => ({
      description: it.description || '', sku: it.sku || '',
      retail: it.retail != null ? String(Number(it.retail)) : '',
      amount: it.amount != null ? String(Number(it.amount)) : ''
    }))
  };
  const editQuote = {
    quoteId: quote.id,
    number: quote.number,
    bundlePct: Number(quote.bundle_pct) || 0,
    cashDeal: Number(quote.cash_deal) > 0 ? String(Number(quote.cash_deal)) : '',
    freeDelivery: !!quote.free_delivery,
    addHst: Number(quote.hst) > 0,
    daysValid: 14,
    memo: quote.memo || '',
    // Blank on a quote raised before these existed, which is the honest answer.
    leadSource: quote.lead_source || '',
    leadBy: quote.lead_by || ''
  };
  const senders = await listLeadSenders().catch(() => []);

  return (
    <div>
      <AdminNav active="quotes" salesOnly={!isAdmin(session)} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Edit {quote.number}</h1>
        <a href="/admin/quotes" className="hint" style={{ textDecoration: 'underline' }}>← Back to quotes</a>
      </div>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>
          Same quote number, updated numbers — the customer gets the revised quote by email and their existing
          link shows the new version. Validity restarts from today.
        </p>
        <QuoteBuilder inventory={inventory} customers={customers} initial={initial} editQuote={editQuote} senders={senders} />
      </div>
    </div>
  );
}
