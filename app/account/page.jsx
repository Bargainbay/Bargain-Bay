import { redirect } from 'next/navigation';
import { getSession } from '../../lib/auth';
import { hasDb, query } from '../../lib/db';
import { getOrdersForCustomer } from '../../lib/orders';
import { invoicesForEmail } from '../../lib/invoices';
import { quotesForEmail } from '../../lib/quotes';
import { getMembership } from '../../lib/members';
import { linkToken } from '../../lib/links';
import MemberRequest from './MemberRequest';
import AccountProfile from './AccountProfile';
import { money, STATUS_LABELS } from '../../lib/constants';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Account — Bargain Bay' };

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '—');
const pillClass = (s) => (['paid', 'converted', 'accepted'].includes(s) ? 'ok' : s === 'open' ? 'warn' : 'sold');

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/account');

  let profile = { email: session.email, name: session.name, phone: '' };
  let orders = [];
  let invoices = [];
  let quotes = [];
  let dbOk = hasDb();
  let membership = null;
  if (dbOk) {
    try {
      const { rows } = await query('SELECT email, name, phone, created_at FROM users WHERE id = $1', [session.userId]);
      if (rows[0]) profile = rows[0];
      // Orders by account OR email — guest orders placed with this email show too.
      orders = await getOrdersForCustomer(session.userId, session.email);
      membership = await getMembership(session.userId);
    } catch (e) {
      console.error('account load failed', e);
      dbOk = false;
    }
    try { invoices = await invoicesForEmail(session.email); } catch (e) { console.error('account invoices failed', e.message); }
    try { quotes = await quotesForEmail(session.email); } catch (e) { console.error('account quotes failed', e.message); }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ color: 'var(--charcoal)', margin: '10px 0' }}>My account</h1>
        <LogoutButton />
      </div>

      <div className="panel">
        <h2>Profile</h2>
        <AccountProfile profile={{ email: profile.email, name: profile.name, phone: profile.phone }} />
      </div>

      <div className="panel">
        <h2>Wholesale / Member access</h2>
        {membership?.role === 'member' && membership?.member_status === 'approved' ? (
          <p style={{ fontSize: 14.5, margin: 0 }}><b style={{ color: '#0B6B3A' }}>✓ You're a member.</b> Wholesale pricing is active across the store and at checkout.</p>
        ) : membership?.member_status === 'pending' ? (
          <p style={{ fontSize: 14.5, margin: 0 }}>Your member application is <b>under review</b>. We'll email you once it's approved.</p>
        ) : (
          <MemberRequest />
        )}
      </div>

      <h2 style={{ color: 'var(--charcoal)' }}>Your orders</h2>
      {!dbOk && <div className="error-box">Order history is unavailable right now.</div>}
      {dbOk && orders.length === 0 && (
        <div className="panel" style={{ textAlign: 'center' }}>
          <p>No orders yet.</p>
          <a href="/shop" className="btn accent">Browse inventory</a>
        </div>
      )}
      {orders.map((o) => (
        <a key={o.id} href={`/order/${o.order_number}?t=${linkToken('order', o.order_number)}`} className="order-card" style={{ display: 'block' }}>
          <div className="row1">
            <b style={{ color: 'var(--charcoal)' }}>{o.order_number}</b>
            <span className={`status-chip status-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>
            {fmtDate(o.created_at)} · {o.items.length} item{o.items.length > 1 ? 's' : ''} · {money(o.total)} · {o.delivery_method === 'delivery' ? 'Delivery' : 'Pickup'}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>
            {o.items.map((it) => it.title).join(' · ')}
          </div>
        </a>
      ))}

      {invoices.length > 0 && (
        <>
          <h2 style={{ color: 'var(--charcoal)' }}>Your invoices</h2>
          <div className="panel">
            {invoices.map((inv) => (
              <div className="summary-row" key={inv.id}>
                <span>
                  <a href={`/invoice/${encodeURIComponent(inv.number)}?t=${linkToken('invoice', inv.number)}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{inv.number}</a>
                  <span className={'pill ' + pillClass(inv.status)} style={{ marginLeft: 8 }}>{inv.status}</span>
                  {inv.status === 'open' && inv.due && <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>due {inv.due}</span>}
                </span>
                <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{money(inv.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {quotes.length > 0 && (
        <>
          <h2 style={{ color: 'var(--charcoal)' }}>Your quotes</h2>
          <div className="panel">
            {quotes.map((qt) => (
              <div className="summary-row" key={qt.id}>
                <span>
                  <a href={`/quote/${encodeURIComponent(qt.number)}?t=${linkToken('quote', qt.number)}`} style={{ fontWeight: 700, textDecoration: 'underline' }}>{qt.number}</a>
                  <span className={'pill ' + pillClass(qt.status)} style={{ marginLeft: 8 }}>{qt.status}</span>
                  {qt.status === 'open' && qt.expires && <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>valid until {qt.expires}</span>}
                </span>
                <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{money(qt.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
