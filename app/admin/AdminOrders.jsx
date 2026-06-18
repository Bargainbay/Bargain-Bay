'use client';
import { useState } from 'react';
import { money, STATUS_LABELS } from '../../lib/constants';

const STATUSES = ['pending_payment', 'confirmed', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];

// Format a stored pickup slot ("YYYY-MM-DDTHH:MM", store-local) for display.
function fmtPickup(value) {
  if (!value) return '';
  const [date, time] = String(value).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const h12 = ((hh + 11) % 12) + 1;
  return `${wd} · ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

export default function AdminOrders({ initialOrders, drivers = [] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const driverName = (id) => { const d = drivers.find((x) => x.id === id); return d ? (d.name || d.email) : null; };

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

  async function schedule(id, deliveryDate, driverId) {
    setSavingId(id); setError('');
    try {
      const res = await fetch('/api/admin/schedule-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: id, deliveryDate, driverId })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Update failed'); return; }
      setOrders((os) => os.map((o) => (o.id === id ? { ...o, delivery_date: deliveryDate || null, driver_id: driverId || null } : o)));
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
        Card payments are paused — orders come in <b>Confirmed · Pending payment</b> (paid by e-transfer or in person).
        When the money lands, click <b>Mark paid</b>: the order moves to <b>Ready for pickup</b>, the unit drops off the
        site for good, and it lands on the tracker-reconciliation list below.
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
                  {o.delivery_method === 'delivery' && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="date"
                        defaultValue={o.delivery_date ? String(o.delivery_date).slice(0, 10) : ''}
                        id={`dd-${o.id}`}
                        style={{ width: 'auto', padding: '3px 6px', fontSize: 12 }}
                      />
                      <select id={`dv-${o.id}`} defaultValue={o.driver_id || ''} style={{ width: 'auto', padding: '3px 6px', fontSize: 12 }}>
                        <option value="">— driver —</option>
                        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name || d.email}</option>)}
                      </select>
                      <button
                        className="btn" style={{ padding: '3px 9px', fontSize: 12 }}
                        disabled={savingId === o.id}
                        onClick={() => schedule(o.id, document.getElementById(`dd-${o.id}`).value, document.getElementById(`dv-${o.id}`).value)}
                      >
                        {savingId === o.id ? '…' : 'Assign'}
                      </button>
                    </div>
                  )}
                  {o.delivery_method === 'delivery' && o.driver_id && (
                    <div style={{ fontSize: 12, color: 'var(--charcoal)', marginTop: 2 }}>
                      🚚 {driverName(o.driver_id) || 'Driver'}{o.delivery_date ? ` · ${String(o.delivery_date).slice(0, 10)}` : ''}
                    </div>
                  )}
                  {o.payment_method && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      Pay: {o.payment_method === 'in_person' ? 'In person' : 'E-transfer'}
                    </div>
                  )}
                  {o.pickup_slot && (
                    <div style={{ fontSize: 12, color: 'var(--charcoal)', marginTop: 2, fontWeight: 600 }}>
                      🕑 Pickup: {fmtPickup(o.pickup_slot)}
                    </div>
                  )}
                </td>
                <td><b>{money(o.total)}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>incl. HST {money(o.hst)}</div></td>
                <td>
                  {o.status === 'pending_payment' ? (
                    <>
                      <span className="status-chip status-confirmed" style={{ display: 'inline-block' }}>Confirmed</span>
                      <span className="pill warn" style={{ marginLeft: 6 }}>Pending payment</span>
                      <div style={{ marginTop: 6 }}>
                        <button
                          className="btn primary"
                          style={{ padding: '5px 10px', fontSize: 12.5 }}
                          disabled={savingId === o.id}
                          onClick={() => setStatus(o.id, 'ready')}
                        >
                          {savingId === o.id ? 'Saving…' : `Mark paid → ${o.delivery_method === 'delivery' ? 'Ready' : 'Ready for pickup'}`}
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className={`status-chip status-${o.status}`} style={{ marginBottom: 6, display: 'inline-block' }}>{STATUS_LABELS[o.status]}</span>
                  )}
                  <br />
                  <select
                    value={o.status}
                    disabled={savingId === o.id}
                    onChange={(e) => setStatus(o.id, e.target.value)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 150 }}>
                  {o.status === 'cancelled'
                    ? 'Cancelled — unit released back to the site.'
                    : o.status === 'pending_payment'
                      ? 'Confirmed, awaiting payment — click Mark paid once it lands.'
                      : 'Sold — see Tracker reconciliation below.'}
                  {(o.pod_signature || (o.pod_photo_ids && o.pod_photo_ids.length > 0)) && (
                    <div style={{ marginTop: 6, color: 'var(--charcoal)' }}>
                      <b>POD:</b>{' '}
                      {o.pod_signature && (
                        <a href={`/api/admin/pod?sig=${o.id}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>signature</a>
                      )}
                      {(o.pod_photo_ids || []).map((pid, i) => (
                        <span key={pid}>{(o.pod_signature || i > 0) ? ' · ' : ''}<a href={`/api/admin/pod?photo=${pid}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>photo {i + 1}</a></span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
