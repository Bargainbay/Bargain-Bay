'use client';
import { useState } from 'react';
import { money, STATUS_LABELS } from '../../lib/constants';

const STATUSES = ['pending_payment', 'confirmed', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

export default function AdminOrders({ initialOrders, sheetsOn }) {
  const [orders, setOrders] = useState(initialOrders);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  async function setStatus(id, status) {
    setSavingId(id); setError('');
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Update failed'); return; }
      setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    } catch {
      setError('Network error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Orders ({orders.length})</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Card payments are paused — orders come in as <b>Pending payment</b> (paid by e-transfer or in person).
        When the money lands, set the order to <b>Confirmed</b>: that holds the sale, removes the unit from the
        site, and adds it to the tracker-reconciliation list below.
      </p>
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>Order</th><th>Customer</th><th>Items</th><th>Fulfilment</th><th>Total</th><th>Status</th><th>Sheet</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <a href={`/order/${o.order_number}?email=${encodeURIComponent(o.email)}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{o.order_number}</a>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(o.created_at).toLocaleString('en-CA')}</div>
                </td>
                <td>
                  {o.name}<br />
                  <a href={`mailto:${o.email}`} style={{ color: 'var(--muted)' }}>{o.email}</a>
                  {o.phone && <div><a href={`tel:${o.phone}`} style={{ color: 'var(--muted)' }}>{o.phone}</a></div>}
                </td>
                <td>
                  {o.items.map((it) => (
                    <div key={it.id} style={{ marginBottom: 2 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.sku}</span> {it.title}
                    </div>
                  ))}
                </td>
                <td>
                  {o.delivery_method === 'delivery'
                    ? <>Delivery<br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{o.address}, {o.city} {o.postal}</span></>
                    : 'Pickup'}
                  {o.payment_method && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      Pay: {o.payment_method === 'in_person' ? 'In person' : 'E-transfer'}
                    </div>
                  )}
                </td>
                <td><b>{money(o.total)}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>incl. HST {money(o.hst)}</div></td>
                <td>
                  <span className={`status-chip status-${o.status}`} style={{ marginBottom: 6, display: 'inline-block' }}>{STATUS_LABELS[o.status]}</span>
                  <br />
                  <select
                    value={o.status}
                    disabled={savingId === o.id}
                    onChange={(e) => setStatus(o.id, e.target.value)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 140 }}>
                  {o.status === 'cancelled'
                    ? 'Cancelled — unit released back to the site.'
                    : o.status === 'pending_payment'
                      ? 'Awaiting payment — set Confirmed once it lands.'
                      : 'Sold — see Tracker reconciliation below.'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
