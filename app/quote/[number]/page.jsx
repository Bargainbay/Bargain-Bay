import { notFound } from 'next/navigation';
import { hasDb } from '../../../lib/db';
import { getQuoteByNumber } from '../../../lib/quotes';
import { getSession, isAdmin } from '../../../lib/auth';
import { verifyLinkToken } from '../../../lib/links';
import { money, SALES_EMAIL } from '../../../lib/constants';
import AcceptQuote from '../../../components/AcceptQuote';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quote — Bargain Bay' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null);
const num = (v) => Number(v) || 0;

export default async function QuotePage({ params, searchParams }) {
  if (!hasDb()) {
    return <div className="narrow"><div className="panel">Quotes are not available — database not configured.</div></div>;
  }
  const quote = await getQuoteByNumber(params.number).catch(() => null);
  if (!quote) return notFound();

  // Access: logged-in admin, or anyone with the matching ?email= (as sent in the
  // quote email). Keeps quote amounts from being enumerable.
  const session = await getSession();
  const guestEmail = String(searchParams?.email || '').trim().toLowerCase();
  const owns =
    (session && isAdmin(session)) ||
    (session && session.email?.toLowerCase() === quote.email?.toLowerCase()) ||
    verifyLinkToken('quote', quote.number, searchParams?.t) ||
    (guestEmail && guestEmail === quote.email?.toLowerCase());
  if (!owns) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Find your quote</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            To view quote <b>{params.number}</b>, open the link from your quote email (it includes your email), or enter it below.
          </p>
          <form method="GET" action={`/quote/${params.number}`}>
            <div className="field">
              <label htmlFor="q-email">Email on the quote</label>
              <input id="q-email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            <button className="btn primary block">View quote</button>
          </form>
        </div>
      </div>
    );
  }

  const cash = quote.cash_deal != null ? num(quote.cash_deal) : null;
  const expired = quote.status === 'expired' || (quote.status === 'open' && quote.expires_at && new Date(quote.expires_at) < new Date());
  const live = quote.status === 'open' && !expired;
  const statusLabel = quote.status === 'converted' ? 'Accepted' : quote.status === 'void' ? 'Void' : expired ? 'Expired' : quote.status === 'accepted' ? 'Accepted' : 'Active';
  const statusCls = quote.status === 'converted' || quote.status === 'accepted' ? 'ok' : (quote.status === 'void' || expired) ? 'sold' : 'warn';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--charcoal)' }}>Quote {quote.number}</h1>
      <div style={{ marginBottom: 8 }}>
        <span className={'pill ' + statusCls}>{statusLabel}</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 10 }}>
          Prepared {fmtDate(quote.created_at)}{quote.expires_at && live ? ` · valid until ${fmtDate(quote.expires_at)}` : ''}
        </span>
      </div>

      {live && (
        <>
          <div className="notice-box" style={{ lineHeight: 1.6 }}>
            <b>This is a quote — not an order.</b> Nothing is reserved yet, and units are first-come, first-served.
            Ready to go ahead? Accept below and we&apos;ll send your invoice to lock it in.
          </div>
          <AcceptQuote
            number={quote.number}
            token={verifyLinkToken('quote', quote.number, searchParams?.t) ? searchParams.t : ''}
            email={guestEmail || (session?.email?.toLowerCase() === quote.email?.toLowerCase() ? session.email : '')}
          />
        </>
      )}
      {quote.status === 'accepted' && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          <b>✓ You&apos;ve accepted this quote.</b> We&apos;ll email your invoice with payment details shortly — your
          units are locked in once it&apos;s issued.
        </div>
      )}
      {expired && quote.status !== 'void' && <div className="error-box">This quote has expired. Email {SALES_EMAIL} and we&apos;ll refresh it for you.</div>}
      {quote.status === 'converted' && <div className="notice-box">This quote has been turned into an invoice. Check your email for payment details.</div>}
      {quote.status === 'void' && <div className="error-box">This quote is no longer valid. Questions? Email {SALES_EMAIL}.</div>}

      <div className="panel">
        <h2>Your package</h2>
        {quote.items.map((it) => (
          <div className="summary-row" key={it.id}>
            <span>{it.description}{it.sku ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> ({it.sku})</span> : null}</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              {num(it.retail) > num(it.amount) ? <span style={{ color: 'var(--muted)', textDecoration: 'line-through', fontSize: 13, marginRight: 8 }}>{money(it.retail)}</span> : null}
              {money(it.amount)}
            </span>
          </div>
        ))}

        <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
          <span>Retail value</span><span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{money(quote.retail_subtotal)}</span>
        </div>
        <div className="summary-row"><span>Our price subtotal</span><span>{money(quote.subtotal)}</span></div>
        {num(quote.bundle_pct) > 0 && (
          <div className="summary-row"><span>Bundle discount ({num(quote.bundle_pct)}%)</span><span>−{money(num(quote.subtotal) - num(quote.bundle_price))}</span></div>
        )}
        <div className="summary-row"><span>Bundle price</span><span>{money(quote.bundle_price)}</span></div>
        {num(quote.hst) > 0 && <div className="summary-row"><span>HST (13%)</span><span>{money(quote.hst)}</span></div>}
        <div className="summary-row total"><span>{cash != null ? 'Bundle total' : 'Total'}</span><span>{money(num(quote.bundle_price) + num(quote.hst))}</span></div>
        {cash != null && <div className="summary-row total" style={{ color: 'var(--ok)' }}><span>Cash deal (all-in)</span><span>{money(cash)}</span></div>}
        {quote.free_delivery && <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--ok)', fontWeight: 600 }}>✓ Free local delivery included</p>}
        {quote.memo && <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>{quote.memo}</p>}
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          Prices in CAD. Subject to availability. RS Solutions Inc. — GST/HST # 708490016 RT0001.
        </p>
      </div>

      <p className="hint">Questions or want to adjust this quote? Email <a href={`mailto:${SALES_EMAIL}`} style={{ textDecoration: 'underline' }}>{SALES_EMAIL}</a> with your quote number.</p>
    </div>
  );
}
