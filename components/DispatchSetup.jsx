'use client';
import { useState } from 'react';

// Clients and drivers, managed on the dispatch page itself. Everything dispatch
// needs is here — sending someone to another screen to add a client mid-call is
// exactly the friction this whole thing exists to remove.
export default function DispatchSetup({ clients = [], drivers = [], canManageDrivers, onChanged }) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function addClient(e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the client a name.'); return; }
    setBusy('client'); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'client', name, contactEmail, contactPhone })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add the client.'); return; }
      setOk(`${d.client?.name || name} added.`);
      setName(''); setContactEmail(''); setContactPhone('');
      onChanged?.();
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(''); }
  }

  async function addDriver(e) {
    e.preventDefault();
    if (!driverEmail.trim()) { setErr("Enter the driver's email."); return; }
    setBusy('driver'); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver', email: driverEmail, on: true })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add the driver.'); return; }
      setOk(`${d.driver?.name || d.driver?.email || driverEmail} can now see their stops.`);
      setDriverEmail('');
      onChanged?.();
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(''); }
  }

  async function removeDriver(email, label) {
    if (!window.confirm(`Stop ${label} seeing deliveries? Their stops stay assigned.`)) return;
    setBusy(email); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver', email, on: false })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not remove them.'); return; }
      onChanged?.();
    } catch { setErr('Network error.'); }
    finally { setBusy(''); }
  }

  return (
    <div className="disp-setup">
      {err && <div className="error-box">{err}</div>}
      {ok && <div className="notice-box">{ok}</div>}

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Clients</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          The companies whose work you run. Adding one here makes it pickable on every new job straight away.
        </p>
        {clients.length > 0 && (
          <ul className="disp-setup-list">
            {clients.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {(c.contact_email || c.contact_phone) && (
                  <span className="hint" style={{ margin: 0 }}>
                    {' '}· {[c.contact_email, c.contact_phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addClient} className="disp-setup-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client company name *" />
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Contact email (optional)" />
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Contact phone (optional)" />
          <button className="btn accent" disabled={busy === 'client'}>{busy === 'client' ? 'Adding…' : 'Add client'}</button>
        </form>
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Drivers</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Anyone here gets a column on the board and sees their own stops at <code>/driver</code>.
          {canManageDrivers
            ? ' They need an account on the site first — one-tap text activation is coming with the driver app.'
            : ' Only an admin can add or remove a driver.'}
        </p>
        {drivers.length > 0 && (
          <ul className="disp-setup-list">
            {drivers.map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                {d.phone && <span className="hint" style={{ margin: 0 }}> · {d.phone}</span>}
                {canManageDrivers && d.email && (
                  <button type="button" className="disp-toggle" disabled={!!busy}
                    style={{ marginLeft: 8 }}
                    onClick={() => removeDriver(d.email, d.name)}>remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManageDrivers && (
          <form onSubmit={addDriver} className="disp-setup-form">
            <input type="email" value={driverEmail} onChange={(e) => setDriverEmail(e.target.value)}
              placeholder="Driver's account email" autoComplete="off" />
            <button className="btn accent" disabled={busy === 'driver'}>{busy === 'driver' ? 'Adding…' : 'Add driver'}</button>
          </form>
        )}
      </section>
    </div>
  );
}
