'use client';
import { useState } from 'react';

// Self-serve pickup scheduler shown on the order page once an order is Ready.
// slots: [{ value, label }] (computed server-side); currentLabel: booked slot label.
export default function PickupBooker({ orderNumber, email, slots = [], currentValue = '', currentLabel = '' }) {
  const [booked, setBooked] = useState(currentValue ? { value: currentValue, label: currentLabel } : null);
  const [choice, setChoice] = useState('');
  const [editing, setEditing] = useState(!currentValue);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function book() {
    if (!choice) { setErr('Please choose a time.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, email, slot: choice })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not book that time.'); return; }
      const picked = slots.find((s) => s.value === d.slot);
      setBooked({ value: d.slot, label: picked ? picked.label : d.slot });
      setEditing(false);
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Schedule your pickup</h2>
      {booked && !editing ? (
        <p style={{ margin: 0, fontSize: 14.5 }}>
          ✓ Pickup booked for <b>{booked.label}</b>.
          <button className="btn" style={{ marginLeft: 12, padding: '4px 10px', fontSize: 12.5 }} onClick={() => { setEditing(true); setChoice(''); }}>
            Change time
          </button>
        </p>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Pick a 30-minute appointment window (Mon–Fri, 10:00am–5:00pm). We&apos;ll have your order ready at the counter.
          </p>
          {err && <div className="error-box">{err}</div>}
          {slots.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>No open slots in the next two weeks — reply to your order email and we&apos;ll arrange a time.</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ minWidth: 240 }}>
                <option value="">Choose a time…</option>
                {slots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button className="btn accent" disabled={busy} onClick={book}>{busy ? 'Booking…' : 'Book pickup'}</button>
              {booked && <button className="btn" style={{ padding: '6px 12px' }} onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
