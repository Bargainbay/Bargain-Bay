'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SERVICES = [
  ['delivery_only', 'Delivery'], ['install', 'Installation'], ['haul_away', 'Haul away'],
  ['door_removal', 'Door removal / replace'], ['exchange', 'Exchange / swap'], ['return_pickup', 'Return pickup']
];

// The client's own "add a delivery" form. Everything lands as a request on our
// dispatch board — nothing here schedules or prices anything.
export default function ClientRequestForm({ clientId, token, demo = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerName: '', phone: '', email: '', address: '', city: '', postal: '', preferredDate: '', notes: '' });
  const [items, setItems] = useState([{ description: '', qty: 1 }]);
  const [services, setServices] = useState(['delivery_only']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k) => setServices(services.includes(k) ? services.filter((x) => x !== k) : [...services, k]);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setDone('');
    if (demo) { setDone('This is a preview — nothing was sent. On your real link this adds the delivery for our dispatch team to schedule.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/client/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: clientId, t: token, ...f, items, services })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add that delivery.'); return; }
      setDone(`Added — ${d.jobNumber}. Our dispatch team will schedule it and it will appear in your list below.`);
      setF({ customerName: '', phone: '', email: '', address: '', city: '', postal: '', preferredDate: '', notes: '' });
      setItems([{ description: '', qty: 1 }]); setServices(['delivery_only']);
      router.refresh();
    } catch { setErr('Network error — nothing was sent.'); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="cp-noprint" style={{ margin: '0 0 18px' }}>
        <button type="button" className="btn primary" onClick={() => setOpen(true)}>+ Add a delivery</button>
        {done && <span className="cp-sub" style={{ marginLeft: 10 }}>{done}</span>}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="cp-panel cp-noprint cp-form">
      <h2>Add a delivery</h2>
      <p className="cp-sub" style={{ marginTop: 0 }}>Our dispatch team will schedule it and let you know. You can follow it below once it is added.</p>
      {err && <div className="error-box">{err}</div>}
      {done && <div className="notice-box">{done}</div>}
      <div className="cp-grid">
        <label>Customer name *<input value={f.customerName} onChange={set('customerName')} required /></label>
        <label>Customer phone *<input value={f.phone} onChange={set('phone')} required inputMode="tel" /></label>
        <label>Customer email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Preferred date (optional)<input type="date" value={f.preferredDate} onChange={set('preferredDate')} /></label>
        <label style={{ gridColumn: '1 / -1' }}>Delivery address *<input value={f.address} onChange={set('address')} required placeholder="Street address" /></label>
        <label>City<input value={f.city} onChange={set('city')} /></label>
        <label>Postal code<input value={f.postal} onChange={set('postal')} /></label>
      </div>

      <div className="cp-k" style={{ margin: '14px 0 4px' }}>Units for this delivery *</div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input style={{ flex: 1 }} value={it.description} placeholder="Brand, model and type (e.g. Whirlpool WRF535SWHZ fridge)"
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          <input style={{ width: 70 }} type="number" min="1" max="50" value={it.qty}
            onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label="Quantity" />
          {items.length > 1 && <button type="button" className="btn" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setItems([...items, { description: '', qty: 1 }])}>+ Another unit</button>

      <div className="cp-k" style={{ margin: '14px 0 4px' }}>Services</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {SERVICES.map(([k, label]) => (
          <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={services.includes(k)} onChange={() => toggle(k)} /> {label}
          </label>
        ))}
      </div>

      <label style={{ display: 'block', marginTop: 14 }}>Notes
        <textarea value={f.notes} onChange={set('notes')} rows={3} placeholder="Stairs, access instructions, anything the crew should know" style={{ width: '100%' }} />
      </label>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add delivery'}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
      </div>
    </form>
  );
}
