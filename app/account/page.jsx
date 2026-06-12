import { redirect } from 'next/navigation';
import { getSession } from '../../lib/auth';
import { hasDb, query } from '../../lib/db';
import { getOrdersForUser } from '../../lib/orders';
import { money, STATUS_LABELS } from '../../lib/constants';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Account — Bargain Bay' };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/account');

  let profile = { email: session.email, name: session.name, phone: '' };
  let orders = [];
  let dbOk = hasDb();
  if (dbOk) {
    try {
      const { rows } = await query('SELECT email, name, phone, created_at FROM users WHERE id = $1', [session.userId]);
      if (rows[0]) profile = rows[0];
      orders = await getOrdersForUser(session.userId);
    } catch (e) {
      console.error('account load failed', e);
      dbOk = false;
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ color: 'var(--charcoal)', margin: '10px 0' }}>My account</h1>
        <LogoutButton />
      </div>

      <div className="panel">
        <h2>Profile</h2>
        <div style={{ fontSize: 14.5, display: 'grid', gap: 4 }}>
          <div><b>Name:</b> {profile.name || '—'}</div>
          <div><b>Email:</b> {profile.email}</div>
          <div><b>Phone:</b> {profile.phone || '—'}</div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Need to change something or reset your password? Email <a href="mailto:sales@bargainbay.ca" style={{ textDecoration: 'underline' }}>sales@bargainbay.ca</a>.
        </p>
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
        <a key={o.id} href={`/order/${o.order_number}`} className="order-card" style={{ display: 'block' }}>
          <div className="row1">
            <b style={{ color: 'var(--charcoal)' }}>{o.order_number}</b>
            <span className={`status-chip status-${o.status}`}>{STATUS_LABELS[o.status]}</span>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>
            {new Date(o.created_at).toLocaleDateString('en-CA')} · {o.items.length} item{o.items.length > 1 ? 's' : ''} · {money(o.total)} · {o.delivery_method === 'delivery' ? 'Delivery' : 'Pickup'}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>
            {o.items.map((it) => it.title).join(' · ')}
          </div>
        </a>
      ))}
    </div>
  );
}
