import { redirect } from 'next/navigation';
import { getSession } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getMembership } from '../../../lib/members';
import { getAvailable } from '../../../lib/inventory';
import { decorate } from '../../../lib/pricing';
import { getOrdersForCustomer } from '../../../lib/orders';
import { invoicesForEmail } from '../../../lib/invoices';
import { quotesForEmail } from '../../../lib/quotes';
import { linkToken } from '../../../lib/links';
import { money, STATUS_LABELS } from '../../../lib/constants';
import MemberCatalogue from '../../../components/MemberCatalogue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Member dashboard — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '—');
const DONE = new Set(['cancelled', 'refunded']);

// The approved member's home: their wholesale catalogue, their orders, what they owe. Anyone else
// is sent to /resellers, so a wholesale price is never rendered for somebody who is not approved —
// the prices below come from decorate(), which itself only gives a member price to an approved member.
export default async function MemberDashboard() {
  const session = await getSession();
  if (!session) redirect('/login?next=/account/member');
  const m = hasDb() ? await getMembership(session.userId) : null;
  if (!(m?.role === 'member' && m?.member_status === 'approved')) redirect('/resellers');

  const [units, orders, invoices, quotes] = await Promise.all([
    getAvailable().then((u) => decorate(u, session)).catch(() => []),
    getOrdersForCustomer(session.userId, session.email).catch(() => []),
    invoicesForEmail(session.email).catch(() => []),
    quotesForEmail(session.email).catch(() => [])
  ]);

  const catalogue = units.map((u) => ({
    id: u.id, title: u.title || `${u.make} ${u.model}`, category: u.category || '', condition: u.condition || '',
    retail: u.compareAt || null, publicPrice: u.clientPrice, price: u.price, onClearance: !!u.onClearance
  }));
  const counted = orders.filter((o) => !DONE.has(o.status));
  const spent = counted.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const owing = invoices.filter((i) => i.status === 'open' || i.status === 'partial');
  const openQuotes = quotes.filter((q) => q.status === 'open');
  const discounted = catalogue.filter((u) => u.price < u.publicPrice).length;

  const tile = { margin: 0, textAlign: 'center' };
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ color: 'var(--charcoal)', margin: '10px 0' }}>{m.business_name || 'Member dashboard'}</h1>
        <span><a href="/account" style={{ textDecoration: 'underline', fontSize: 14 }}>Profile &amp; settings</a></span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Signed in as {session.email}. Your wholesale price applies in the shop and at checkout automatically.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
        <div className="panel" style={tile}><div style={{ fontSize: 26, fontWeight: 800 }}>{catalogue.length}</div><div className="hint">units in stock</div></div>
        <div className="panel" style={tile}><div style={{ fontSize: 26, fontWeight: 800 }}>{discounted}</div><div className="hint">at a member discount</div></div>
        <div className="panel" style={tile}><div style={{ fontSize: 26, fontWeight: 800 }}>{counted.length}</div><div className="hint">orders · {money(spent)}</div></div>
        <div className="panel" style={tile}>
          <div style={{ fontSize: 26, fontWeight: 800, color: owing.length ? '#b45309' : undefined }}>{owing.length}</div>
          <div className="hint">open invoice{owing.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <h2 style={{ color: 'var(--charcoal)' }}>Wholesale catalogue</h2>
      {catalogue.length === 0
        ? <div className="panel">No stock is available right now. New units arrive often, so check back soon.</div>
        : <MemberCatalogue units={catalogue} />}

      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Your orders</h2>
      {orders.length === 0 ? (
        <div className="panel">No orders yet. <a href="/shop" style={{ textDecoration: 'underline' }}>Browse the shop</a>, or pick from the catalogue above.</div>
      ) : orders.slice(0, 10).map((o) => (
        <a key={o.id} href={`/order/${o.order_number}?t=${linkToken('order', o.order_number)}`} className="order-card" style={{ display: 'block' }}>
          <div className="row1">
            <b style={{ color: 'var(--charcoal)' }}>{o.order_number}</b>
            <span className={`status-chip status-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>
            {fmtDate(o.created_at)} · {o.items.length} item{o.items.length > 1 ? 's' : ''} · {money(o.total)}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>{o.items.map((it) => it.title).join(' · ')}</div>
        </a>
      ))}
      {orders.length > 10 && <p className="hint">Showing your 10 most recent of {orders.length}. <a href="/account" style={{ textDecoration: 'underline' }}>All orders</a></p>}

      {owing.length > 0 && (
        <>
          <h2 style={{ color: 'var(--charcoal)' }}>Invoices to pay</h2>
          <div className="panel">
            {owing.map((inv) => (
              <div className="summary-row" key={inv.id}>
                <span><a href={`/invoice/${encodeURIComponent(inv.number)}?t=${linkToken('invoice', inv.number)}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{inv.number}</a>
                  {inv.due && <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>due {inv.due}</span>}</span>
                <span style={{ fontWeight: 600 }}>{money(inv.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {openQuotes.length > 0 && (
        <>
          <h2 style={{ color: 'var(--charcoal)' }}>Open quotes</h2>
          <div className="panel">
            {openQuotes.map((qt) => (
              <div className="summary-row" key={qt.id}>
                <span><a href={`/quote/${encodeURIComponent(qt.number)}?t=${linkToken('quote', qt.number)}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{qt.number}</a>
                  {qt.expires && <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>valid until {qt.expires}</span>}</span>
                <span style={{ fontWeight: 600 }}>{money(qt.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="hint" style={{ marginTop: 24 }}>Need a larger quantity or a custom quote? <a href="/contact" style={{ textDecoration: 'underline' }}>Contact us</a>.</p>
    </div>
  );
}
