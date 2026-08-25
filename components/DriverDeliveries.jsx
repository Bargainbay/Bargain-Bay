'use client';
import { useState } from 'react';
import { STATUS_LABELS } from '../lib/constants';
import PodCapture from './PodCapture';

const mapsUrl = (o) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.city, o.postal].filter(Boolean).join(', '))}`;

export default function DriverDeliveries({ initialDeliveries = [] }) {
  const [list, setList] = useState(initialDeliveries);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function start(id) {
    setBusy(id); setError('');
    try {
      const res = await fetch('/api/driver/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id })
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not start delivery'); return; }
      setList((xs) => xs.map((o) => (o.id === id ? { ...o, status: 'out_for_delivery' } : o)));
    } catch {
      setError('Network error');
    } finally {
      setBusy(null);
    }
  }

  const markDelivered = (id) => setList((xs) => xs.map((o) => (o.id === id ? { ...o, status: 'delivered' } : o)));

  if (!list.length) {
    return <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>No deliveries assigned right now. Check back later.</div>;
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {list.map((o) => {
        const out = o.status === 'out_for_delivery';
        return (
          <div className="panel" key={o.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <b style={{ color: 'var(--charcoal)', fontSize: 16 }}>{o.order_number}</b>
              <span className={`status-chip status-${o.status}`}>{STATUS_LABELS[o.status]}</span>
            </div>
            {o.delivery_date && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Scheduled: {o.delivery_date}</div>}

            <div style={{ marginTop: 10, fontSize: 14.5 }}>
              <div><b>{o.name}</b></div>
              <div>
                <a href={mapsUrl(o)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
                  {o.address}, {o.city} {o.postal}
                </a>
              </div>
              {o.phone && <div><a href={`tel:${o.phone}`} style={{ textDecoration: 'underline' }}>📞 {o.phone}</a></div>}
            </div>

            {o.balance_due > 0 && (
              <div className="disp-collect" style={{ fontSize: 15 }}>
                Collect ${Number(o.balance_due).toFixed(2)} on delivery
                {o.invoice_number ? <span className="disp-collect-ref"> · {o.invoice_number}</span> : null}
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 13.5 }}>
              {o.items.map((it) => (
                <div key={it.sku}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.sku}</span> {it.title}</div>
              ))}
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {o.status === 'delivered' ? (
                <span className="pill ok" style={{ alignSelf: 'center' }}>✓ Delivered</span>
              ) : !out ? (
                <button className="btn accent" disabled={busy === o.id} onClick={() => start(o.id)}>
                  {busy === o.id ? 'Starting…' : 'Start delivery'}
                </button>
              ) : (
                <span className="pill ok" style={{ alignSelf: 'center' }}>On the way</span>
              )}
              <a className="btn" href={mapsUrl(o)} target="_blank" rel="noopener noreferrer">Navigate</a>
            </div>

            {out && <PodCapture order={o} onDelivered={() => markDelivered(o.id)} />}
          </div>
        );
      })}
    </div>
  );
}
