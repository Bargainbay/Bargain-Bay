'use client';
import { useCallback, useEffect, useState } from 'react';

// Clients and drivers, managed on the dispatch page itself. Everything dispatch
// needs is here — sending someone to another screen to add a client mid-call is
// exactly the friction this whole thing exists to remove.
export default function DispatchSetup({ clients = [], drivers = [], canManageDrivers, onChanged }) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [roster, setRoster] = useState(drivers);
  const [link, setLink] = useState(null);   // the sign-in link just minted
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

  // Load the roster with the bits only the office cares about (last seen, link
  // state) — the board's own driver list is just names for the columns.
  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dispatch?view=drivers');
      const d = await res.json();
      if (res.ok && Array.isArray(d.drivers)) setRoster(d.drivers);
    } catch { /* keep what we have */ }
  }, []);

  useEffect(() => { if (canManageDrivers) loadRoster(); }, [canManageDrivers, loadRoster]);

  async function addDriverByPhone(e) {
    e.preventDefault();
    if (!driverName.trim()) { setErr("Enter the driver's name."); return; }
    if (!driverPhone.trim()) { setErr('Enter their mobile number — that is where the link goes.'); return; }
    setBusy('driver'); setErr(''); setOk(''); setLink(null);
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_phone', name: driverName, phone: driverPhone })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add the driver.'); return; }
      setOk(d.texted
        ? `Texted ${d.driver?.name || driverName} their sign-in link.`
        : `${d.driver?.name || driverName} added — send them the link below.`);
      setLink(d);
      setDriverName(''); setDriverPhone('');
      await loadRoster();
      onChanged?.();
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(''); }
  }

  // Re-send: a new phone, a lost text, a driver who never tapped it. Minting a
  // new link kills the old one, so there is only ever one live key per driver.
  async function sendLink(driverId, label) {
    setBusy(`link${driverId}`); setErr(''); setOk(''); setLink(null);
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_link', driverId })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not send the link.'); return; }
      setOk(d.texted ? `Texted ${label}.` : `Link ready for ${label} — send it to them.`);
      setLink(d);
      await loadRoster();
    } catch { setErr('Network error — nothing was sent.'); }
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
          A driver gets a column on the board and their own stop list on their phone.
          {canManageDrivers
            ? ' Add them by name and mobile — they get a text, tap it once, and that phone is signed in. No account, no password.'
            : ' Only an admin can add or remove a driver.'}
        </p>

        {roster.length > 0 && (
          <ul className="disp-setup-list">
            {roster.map((d) => (
              <li key={d.id}>
                <strong>{d.name || d.email}</strong>
                {d.phone && <span className="hint" style={{ margin: 0 }}> · {d.phone}</span>}
                {/* Whether the driver has ever actually opened the app is the
                    thing the office needs to see — a link that was texted and
                    never tapped is the failure this flow exists to surface. */}
                <span className="hint" style={{ margin: 0 }}>
                  {' · '}
                  {d.lastSeen
                    ? `on their phone ${new Date(d.lastSeen).toLocaleDateString('en-CA')}`
                    : d.linkSentAt ? 'texted, not opened yet' : 'no link sent yet'}
                </span>
                {canManageDrivers && (
                  <>
                    <button type="button" className="disp-toggle" style={{ marginLeft: 8 }} disabled={!!busy}
                      onClick={() => sendLink(d.id, d.name || d.email)}>
                      {busy === `link${d.id}` ? 'sending…' : (d.lastSeen ? 're-send link' : 'text link')}
                    </button>
                    {d.email && (
                      <button type="button" className="disp-toggle" style={{ marginLeft: 8 }} disabled={!!busy}
                        onClick={() => removeDriver(d.email, d.name)}>remove</button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {link && (
          <div className="disp-linkbox">
            <b>{link.texted ? 'Texted.' : 'Not texted — send this to them yourself:'}</b>
            <div className="disp-linkurl">{link.url}</div>
            <div className="hint" style={{ margin: '4px 0 0' }}>
              Single use, good for 14 days. {link.smsError ? `Text failed: ${link.smsError}` : 'Tapping it signs that phone in.'}
            </div>
            <button type="button" className="disp-toggle" onClick={() => setLink(null)}>hide</button>
          </div>
        )}

        {canManageDrivers && (
          <form onSubmit={addDriverByPhone} className="disp-setup-form">
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)}
              placeholder="Driver's name *" autoComplete="off" />
            <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}
              placeholder="Mobile number *" inputMode="tel" autoComplete="off" />
            <button className="btn accent" disabled={busy === 'driver'}>
              {busy === 'driver' ? 'Adding…' : 'Add + text link'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
