import { notFound } from 'next/navigation';
import { hasDb } from '../../../lib/db';
import { getInvoiceByNumber } from '../../../lib/invoices';
import { getSession, isAdmin } from '../../../lib/auth';
import { verifyLinkToken } from '../../../lib/links';
import { money, SALES_EMAIL, ETRANSFER_EMAIL } from '../../../lib/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice — Bargain Bay' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null);

export default async function InvoicePage({ params, searchParams }) {
  if (!hasDb()) {
    return <div className="narrow"><div className="panel">Invoices are not available — database not configured.</div></div>;
  }
  const invoice = await getInvoiceByNumber(params.number).catch(() => null);
  if (!invoice) return notFound();

  // Access: logged-in admin, or anyone with the matching ?email= (as in the
  // confirmation email link). Keeps invoice amounts from being enumerable.
  const session = await getSession();
  const guestEmail = String(searchParams?.email || '').trim().toLowerCase();
  const owns =
    (session && isAdmin(session)) ||
    (session && session.email?.toLowerCase() === invoice.email?.toLowerCase()) ||
    verifyLinkToken('invoice', invoice.number, searchParams?.t) ||
    (guestEmail && guestEmail === invoice.email?.toLowerCase());
  if (!owns) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Find your invoice</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            To view invoice <b>{params.number}</b>, open the link from your invoice email (it includes your email), or enter it below.
          </p>
          <form method="GET" action={`/invoice/${params.number}`}>
            <div className="field">
              <label htmlFor="inv-email">Email on the invoice</label>
              <input id="inv-email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            <button className="btn primary block">View invoice</button>
          </form>
        </div>
      </div>
    );
  }

  const open = invoice.status === 'open';
  const paid = invoice.status === 'paid';
  const voided = invoice.status === 'void';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--charcoal)' }}>Invoice {invoice.number}</h1>
      <div style={{ marginBottom: 8 }}>
        <span className={'pill ' + (paid ? 'ok' : voided ? 'sold' : 'warn')}>{paid ? 'Paid' : voided ? 'Void' : 'Open'}</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 10 }}>
          Issued {fmtDate(invoice.created_at)}{invoice.due_date && open ? ` · due ${fmtDate(invoice.due_date)}` : ''}
        </span>
      </div>

      {paid && <div className="notice-box">Paid{invoice.paid_at ? ` on ${fmtDate(invoice.paid_at)}` : ''}{invoice.payment_method ? ` · ${invoice.payment_method}` : ''} — thank you!</div>}
      {voided && <div className="error-box">This invoice was voided. Questions? Email {SALES_EMAIL}.</div>}

      {open && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          <b>Pay by Interac e-Transfer.</b><br />
          Send <b>{money(invoice.total)}</b> to <b>{ETRANSFER_EMAIL}</b> (auto-deposit — no security question).
          Put invoice number <b>{invoice.number}</b> in the message so we can match it. Prefer to pay in person?
          Reply to your invoice email and we&apos;ll arrange it.
        </div>
      )}

      <div className="panel">
        <h2>Items</h2>
        {invoice.items.map((it) => (
          <div className="summary-row" key={it.id}>
            <span>{it.description}{it.sku ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> ({it.sku})</span> : null}</span>
            <span>{money(it.amount)}</span>
          </div>
        ))}
        <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
          <span>Subtotal</span><span>{money(invoice.subtotal)}</span>
        </div>
        {Number(invoice.hst) > 0 && (
          <div className="summary-row"><span>HST (13%)</span><span>{money(invoice.hst)}</span></div>
        )}
        <div className="summary-row total"><span>Total</span><span>{money(invoice.total)}</span></div>
        {invoice.memo && <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{invoice.memo}</p>}
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          RS Solutions Inc. — GST/HST # 708490016 RT0001.
        </p>
      </div>

      <p className="hint">Questions about this invoice? Email <a href={`mailto:${SALES_EMAIL}`} style={{ textDecoration: 'underline' }}>{SALES_EMAIL}</a> with your invoice number.</p>
    </div>
  );
}
