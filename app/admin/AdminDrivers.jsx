'use client';
import { useState } from 'react';

// Manage delivery drivers: list, add by email, remove. A driver is just a user
// account flagged is_driver — they must have signed up first.
export default function AdminDrivers({ initialDrivers = [] }) {
  const [drivers, setDrivers] = useState(initialDrivers);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function update(addr, on) {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/drivers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr, on })
      });
      const d = await res.json();
      if (!res.ok) { setMsg('✗ ' + (d.error || 'Failed')); return; }
      setDrivers(d.drivers || []);
      if (on) { setMsg(`✓ Added ${addr} as a driver.`); setEmail(''); }
      else setMsg(`✓ Removed ${addr}.`);
    } catch {
      setMsg('✗ Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Delivery drivers ({drivers.length})</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        Drivers sign in with their own account and work their stops at <code>/driver</code>. Add someone by the email
        they signed up with (have them create an account first if needed).
      </p>
      <div className="panel">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: drivers.length ? 12 : 0 }}>
          <input type="email" placeholder="driver@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 280 }} />
          <button className="btn primary" disabled={busy || !email.trim()} onClick={() => update(email.trim().toLowerCase(), true)}>
            {busy ? 'Saving…' : 'Add driver'}
          </button>
          {msg && <span style={{ fontSize: 13, fontWeight: 600 }}>{msg}</span>}
        </div>
        {drivers.length > 0 && (
          <div className="table-wrap">
            <table className="admin">
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name || '—'}</td>
                    <td>{d.email}</td>
                    <td>{d.phone || '—'}</td>
                    <td>
                      <button className="btn danger" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy} onClick={() => update(d.email, false)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
