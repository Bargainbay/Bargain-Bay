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
      <h1 style={{ color: 'var(--navy)' }}>Orders ({orders.length})</h1>
      <p className="hint" style={{ marginBottom: 14 }}>
        Sheet sync: {sheetsOn
          ? 'ON — paid orders auto-write "Sold" to the master tracker.'
          : 'OFF (set GOOGLE_CREDENTIALS + SHEET_WRITEBACK=1) — mark units Sold in the master sheet manually.'}
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
                  <a href={`/order/${o.order_number}?email=${encodeURIComponent(o.email)}`} style={{ fontWeight: 700, color: 'var(--navy)' }}>{o.order_number}</a>
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
                    ? 'If it was marked Sold, set it back to available in the master sheet.'
                    : o.status === 'pending_payment'
                      ? '—'
                      : sheetsOn ? 'Auto-synced on payment.' : 'Mark sold in master sheet.'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
