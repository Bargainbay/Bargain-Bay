'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Edit a customer's contact card + notes on their profile page. Email is the
// identity key, so it stays read-only here.
export default function CustomerEditor({ customer }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    name: customer.name || '', phone: customer.phone || '',
    address: customer.address || '', city: customer.city || '', postal: customer.postal || '',
    notes: customer.notes || ''
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: customer.id, ...f })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save.'); return; }
      setEditing(false);
      router.refresh();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
          <div><span style={{ color: 'var(--muted)' }}>Email</span> — {customer.email}</div>
          <div><span style={{ color: 'var(--muted)' }}>Phone</span> — {customer.phone || '—'}</div>
          <div><span style={{ color: 'var(--muted)' }}>Address</span> — {[customer.address, customer.city, customer.postal].filter(Boolean).join(', ') || '—'}</div>
        </div>
        {customer.notes && (
          <div style={{ marginTop: 10, fontSize: 13.5, whiteSpace: 'pre-wrap', borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
            {customer.notes}
          </div>
        )}
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>Edit details</button>
      </div>
    );
  }

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      <div className="form-2col">
        <div className="field"><label>Name</label><input value={f.name} onChange={set('name')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
      </div>
      <div className="field"><label>Street address</label><input value={f.address} onChange={set('address')} /></div>
      <div className="form-2col">
        <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
        <div className="field"><label>Postal code</label><input value={f.postal} onChange={set('postal')} /></div>
      </div>
      <div className="field">
        <label>Notes (only you see these)</label>
        <textarea rows={4} value={f.notes} onChange={set('notes')} placeholder="Preferences, past issues, delivery instructions…" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn accent" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}
