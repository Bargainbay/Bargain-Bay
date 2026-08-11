import { notFound } from 'next/navigation';
import { hasDb } from '../../../lib/db';
import { getInvoiceByNumber } from '../../../lib/invoices';
import { getSession, isAdmin } from '../../../lib/auth';
import { linkToken, verifyLinkToken } from '../../../lib/links';
import { money, SALES_EMAIL, ETRANSFER_EMAIL, warrantyLabel,
         BUSINESS_NAME, BUSINESS_LEGAL, BUSINESS_ADDRESS, HST_NUMBER, PICKUP_ADDRESS, SERVICE_EMAIL, RETURN_POLICY_SUMMARY } from '../../../lib/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice — Bargain Bay' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null);

export default async function InvoicePage({ params, searchParams }) {
  const { number } = await params;
  const sParams = await searchParams;
  if (!hasDb()) {
    return <div className="narrow"><div className="panel">Invoices are not available — database not configured.</div></div>;
  }
  const invoice = await getInvoiceByNumber(number).catch(() => null);
  if (!invoice) return notFound();

  // Access: logged-in admin, or anyone with the matching ?email= (as in the
  // confirmation email link). Keeps invoice amounts from being enumerable.
  const session = await getSession();
  const guestEmail = String(sParams?.email || '').trim().toLowerCase();
  const owns =
    (session && isAdmin(session)) ||
    (session && session.email?.toLowerCase() === invoice.email?.toLowerCase()) ||
    verifyLinkToken('invoice', invoice.number, sParams?.t) ||
    (guestEmail && guestEmail === invoice.email?.toLowerCase());
  if (!owns) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Find your invoice</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            To view invoice <b>{number}</b>, open the link from your invoice email (it includes your email), or enter it below.
          </p>
          <form method="GET" action={`/invoice/${number}`}>
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
  const partial = invoice.status === 'partial';
  const paid = invoice.status === 'paid';
  const voided = invoice.status === 'void';
  const refunded = invoice.status === 'refunded';
  const delivery = invoice.delivery_method === 'delivery';
  const refundTotal = Number(invoice.refund_total) || 0;
  const partialRefund = paid && refundTotal > 0;
  const amountPaid = Number(invoice.amountPaid) || 0;
  const balance = Number(invoice.balance) || 0;
  const statusLabel = paid ? (partialRefund ? 'Paid · partial refund' : 'Paid') : refunded ? 'Refunded' : voided ? 'Void' : partial ? 'Partially paid' : 'Open';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Business letterhead */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--charcoal)', paddingBottom: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--charcoal)' }}>{BUSINESS_NAME}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{BUSINESS_LEGAL} · {BUSINESS_ADDRESS}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{SALES_EMAIL} · HST# {HST_NUMBER}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--charcoal)' }}>INVOICE</div>
          <div style={{ fontSize: 13 }}>{invoice.number}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <span>
          <span className={'pill ' + (paid ? 'ok' : (voided || refunded) ? 'sold' : 'warn')}>{statusLabel}</span>
          <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 10 }}>
            Issued {fmtDate(invoice.created_at)}{invoice.due_date && open ? ` · due ${fmtDate(invoice.due_date)}` : ''}
          </span>
        </span>
        {/* The token gate is already passed to render this page, so embedding a
            fresh token keeps the download working however the viewer got here. */}
        <a className="btn" href={`/invoice/${encodeURIComponent(invoice.number)}/pdf?t=${linkToken('invoice', invoice.number)}`}>
          ⬇ Download PDF
        </a>
      </div>

      {/* Bill To / Ship To */}
      <div className="panel" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 3 }}>Bill to</div>
          {invoice.name && <div style={{ fontWeight: 700 }}>{invoice.name}</div>}
          <div>{invoice.email}</div>
          {invoice.phone && <div>{invoice.phone}</div>}
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 3 }}>{delivery ? 'Ship to (delivery)' : 'Fulfilment'}</div>
          {delivery ? (
            <>
              {invoice.name && <div style={{ fontWeight: 700 }}>{invoice.name}</div>}
              {invoice.address && <div>{invoice.address}</div>}
              {(invoice.city || invoice.postal) && <div>{[invoice.city, invoice.postal].filter(Boolean).join(' ')}</div>}
            </>
          ) : (
            <>
              <div>Pickup by appointment</div>
              <div style={{ color: 'var(--muted)' }}>{PICKUP_ADDRESS}</div>
            </>
          )}
        </div>
      </div>

      {paid && <div className="notice-box">Paid{invoice.paid_at ? ` on ${fmtDate(invoice.paid_at)}` : ''}{invoice.payment_method ? ` · ${invoice.payment_method}` : ''} — thank you!</div>}
      {partialRefund && (
        <div className="notice-box">
          {money(refundTotal)} of this invoice was refunded — the refunded item(s) are shown struck through below.
          Questions? Email {SALES_EMAIL}.
        </div>
      )}
      {refunded && <div className="notice-box">This invoice was refunded{invoice.refunded_at ? ` on ${fmtDate(invoice.refunded_at)}` : ''}. Questions? Email {SALES_EMAIL}.</div>}
      {voided && <div className="error-box">This invoice was voided. Questions? Email {SALES_EMAIL}.</div>}

      {(open || partial) && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          <b>Pay by Interac e-Transfer.</b><br />
          {partial && <>We&apos;ve received <b>{money(amountPaid)}</b> so far — thank you! </>}
          Send <b>{money(partial ? balance : invoice.total)}</b> to <b>{ETRANSFER_EMAIL}</b> (auto-deposit — no security question).
          Put invoice number <b>{invoice.number}</b> in the message so we can match it. Prefer to pay in person?
          Reply to your invoice email and we&apos;ll arrange it.
        </div>
      )}

      <div className="panel">
        <h2>Items</h2>
        {invoice.items.map((it) => {
          const w = warrantyLabel(it.warranty_months);
          const lineRefunded = !!it.refunded_at && (partialRefund || refunded);
          return (
            <div className="summary-row" key={it.id} style={{ alignItems: 'flex-start', opacity: lineRefunded ? 0.6 : 1 }}>
              <span style={{ textDecoration: lineRefunded ? 'line-through' : 'none' }}>
                {it.description}{it.sku ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> ({it.sku})</span> : null}
                {lineRefunded && <span className="pill sold" style={{ fontSize: 11, marginLeft: 6 }}>Refunded</span>}
                {w && !lineRefunded && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--green, #0f6e56)' }}>✓ {w}</span>}
              </span>
              <span style={{ textDecoration: lineRefunded ? 'line-through' : 'none' }}>{money(it.amount)}</span>
            </div>
          );
        })}
        <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
          <span>Subtotal</span><span>{money(invoice.subtotal)}</span>
        </div>
        {Number(invoice.hst) > 0 && (
          <div className="summary-row"><span>HST (13%)</span><span>{money(invoice.hst)}</span></div>
        )}
        <div className="summary-row total"><span>Total</span><span>{money(invoice.total)}</span></div>
        {partial && (
          <>
            <div className="summary-row"><span>Paid so far</span><span>−{money(amountPaid)}</span></div>
            <div className="summary-row total"><span>Balance owing</span><span>{money(balance)}</span></div>
          </>
        )}
        {partialRefund && (
          <>
            <div className="summary-row"><span>Refunded</span><span>−{money(refundTotal)}</span></div>
            <div className="summary-row total"><span>Net after refund</span><span>{money(Math.max(0, Number(invoice.total) - refundTotal))}</span></div>
          </>
        )}
        {invoice.memo && <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{invoice.memo}</p>}
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          {BUSINESS_LEGAL} — GST/HST # {HST_NUMBER}.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Returns &amp; warranty</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
          {RETURN_POLICY_SUMMARY.map((p, i) => <li key={i} style={{ marginBottom: 5 }}>{p}</li>)}
        </ul>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>
          Returns &amp; warranty claims: <a href={`mailto:${SERVICE_EMAIL}`} style={{ textDecoration: 'underline' }}>{SERVICE_EMAIL}</a> (with your invoice number, model, issue &amp; photos).
          Full policy: <a href="/policies/returns" style={{ textDecoration: 'underline' }}>bargainbay.ca/policies/returns</a>.
        </p>
      </div>

      <p className="hint">Questions about this invoice? Email <a href={`mailto:${SALES_EMAIL}`} style={{ textDecoration: 'underline' }}>{SALES_EMAIL}</a> with your invoice number.</p>
    </div>
  );
}
