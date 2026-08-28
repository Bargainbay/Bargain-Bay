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
  const [merge, setMerge] = useState(null);       // a duplicate account waiting to be folded in
  const [sameName, setSameName] = useState(null); // the driver an "add" collided with
  const [vans, setVans] = useState([]);
  const [reviewUrl, setReviewUrl] = useState('');
  const [vanName, setVanName] = useState('');
  const [vanPlate, setVanPlate] = useState('');
  const [vanFuel, setVanFuel] = useState('us');
  const [vanCarrier, setVanCarrier] = useState('');
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

  // The vans. An odometer reading that doesn't say which truck it came off is
  // not a mileage figure — it's two trucks' numbers in one column.
  const loadVans = useCallback(async () => {
    try {
      const d = await fetch('/api/admin/dispatch?view=vehicles').then((r) => r.json());
      if (Array.isArray(d.vehicles)) setVans(d.vehicles);
    } catch { /* keep what we have */ }
  }, []);
  useEffect(() => { loadVans(); }, [loadVans]);

  // The Google review link. It reaches the driver's phone with their stop list,
  // so it is on the handset BEFORE they are standing at a door with one bar.
  useEffect(() => {
    fetch('/api/admin/dispatch?view=review_link')
      .then((r) => r.json()).then((d) => setReviewUrl(d.url || '')).catch(() => {});
  }, []);

  async function saveReviewLink(e) {
    e.preventDefault();
    setBusy('review'); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_link', url: reviewUrl })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save the link.'); return; }
      setOk(reviewUrl ? 'Review link saved — the drivers get it with their next stop list.' : 'Review link cleared.');
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(''); }
  }

  async function saveVan(e) {
    e.preventDefault();
    if (!vanName.trim()) { setErr('Give the van a name — whatever the crew calls it.'); return; }
    setBusy('van'); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'vehicle', name: vanName, plate: vanPlate,
          fuelPaidBy: vanFuel, carrierName: vanCarrier
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save the van.'); return; }
      setOk(`${d.vehicle.name} added.`);
      setVanName(''); setVanPlate(''); setVanFuel('us'); setVanCarrier('');
      await loadVans();
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(''); }
  }

  async function toggleVan(v) {
    setBusy(`van${v.id}`); setErr('');
    try {
      await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'vehicle', id: v.id, name: v.name, plate: v.plate, active: !v.active,
          fuelPaidBy: v.fuelPaidBy, carrierName: v.carrierName
        })
      });
      await loadVans();
    } catch { setErr('Network error.'); }
    finally { setBusy(''); }
  }

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
      if (!res.ok) {
        setErr(d.error || 'Could not add the driver.');
        // Somebody with this name already drives for us. Almost always this is a
        // driver on a new phone — so put the button that actually fixes it in
        // front of whoever just tried to add them again.
        if (d.code === 'DRIVER_NAME_TAKEN' && d.driver?.id) setSameName({ ...d.driver, typed: driverPhone });
        return;
      }
      setOk(d.texted
        ? `Texted ${d.driver?.name || driverName} their sign-in link.`
        : `${d.driver?.name || driverName} added — send them the link below.`);
      setLink(d);
      setDriverName(''); setDriverPhone(''); setSameName(null);
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

  // The number changes, the account doesn't. Everything about a driver hangs off
  // their account id — their stops, their column, their pay, their signed PODs —
  // so a new phone must never mean a new account. It used to: matching is by
  // number, so re-adding somebody built a second driver, and from that moment
  // the same person had two columns on the board and half a history in each.
  async function changeNumber(driverId, label, current, preset) {
    const next = preset ?? window.prompt(`New mobile number for ${label}:`, current || '');
    if (next === null) return;
    setBusy(`phone${driverId}`); setErr(''); setOk(''); setLink(null); setSameName(null);
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_rephone', driverId, phone: next })
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error || 'Could not change the number.');
        // The number is already somebody else's — offer the repair rather than
        // leaving the office with an error and no move.
        if (d.code === 'PHONE_TAKEN' && d.driver?.isDriver) {
          setMerge({ keep: { id: driverId, name: label }, drop: d.driver });
        }
        return;
      }
      setOk(d.driver?.unchanged
        ? `${label} was already on that number.`
        : `${label} is on ${d.driver.phone} now. They sign in at /driver with the new number — `
          + 'we text them a code. Any old link on the old phone has been killed.');
      await loadRoster();
      onChanged?.();
    } catch { setErr('Network error — nothing was changed.'); }
    finally { setBusy(''); }
  }

  // Folding a duplicate back into the real account. This is the repair for
  // somebody who was already added twice, which before there was any way to
  // change a number was the only way to keep driving after a new phone.
  async function doMerge() {
    if (!merge) return;
    if (!window.confirm(
      `Move every stop, order and payment from ${merge.drop.name || 'the duplicate'} onto ${merge.keep.name}, `
      + 'and switch the duplicate off? This cannot be undone from here.'
    )) return;
    setBusy('merge'); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_merge', keepId: merge.keep.id, dropId: merge.drop.id })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not merge them.'); return; }
      setOk(`Merged — ${d.jobs} stop(s) and ${d.orders || 0} order(s) moved onto ${d.keep.name}.`);
      setMerge(null);
      await loadRoster();
      onChanged?.();
    } catch { setErr('Network error — nothing was merged.'); }
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

      {canManageDrivers && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Google review code</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            <b>The link is all we need — the app draws the QR code itself</b>, on the handset, so it works
            with no signal and stays sharp at any size. There is nothing to upload.
          </p>
          <p className="hint" style={{ marginTop: 0 }}>
            Two ways to get the link: in <b>Google Business Profile</b> it&apos;s <b>Ask for reviews</b>, and
            it looks like <code>https://g.page/r/…/review</code> — or, if you already have a review card or
            QR code, <b>point your phone camera at it</b> and copy the address it offers to open. That&apos;s
            the same link, and it&apos;s exactly what your existing code has inside it.
          </p>
          <form onSubmit={saveReviewLink} className="disp-setup-form">
            <input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} style={{ minWidth: 320 }}
              placeholder="https://g.page/r/…/review" inputMode="url" />
            <button className="btn accent" disabled={busy === 'review'}>
              {busy === 'review' ? 'Saving…' : 'Save link'}
            </button>
          </form>
          {reviewUrl && (
            <p className="hint">
              Drivers see <b>⭐ Ask for a Google review</b> on a stop once it&apos;s finished.{' '}
              <a href={reviewUrl} target="_blank" rel="noopener noreferrer">Check the link goes to the right page ↗</a>
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Vans</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Drivers pick one when they start a shift, and the odometer readings hang off it. Without a van
          on the reading, two trucks&apos; numbers land in one column and the mileage means nothing.
        </p>
        {vans.length > 0 && (
          <ul className="disp-setup-list">
            {vans.map((v) => (
              <li key={v.id} style={{ opacity: v.active ? 1 : 0.55 }}>
                <strong>{v.name}</strong>
                {v.plate && <span className="hint" style={{ margin: 0 }}> · {v.plate}</span>}
                <span className="hint" style={{ margin: 0 }}>
                  {v.fuelPaidBy === 'carrier'
                    ? ` · fuel billed by ${v.carrierName || 'the carrier'}`
                    : ' · we pay the fuel'}
                </span>
                {!v.active && <span className="hint" style={{ margin: 0 }}> · retired</span>}
                <button type="button" className="disp-toggle" style={{ marginLeft: 8 }} disabled={!!busy}
                  onClick={() => toggleVan(v)}>{v.active ? 'retire' : 'bring back'}</button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={saveVan} className="disp-setup-form">
          <input value={vanName} onChange={(e) => setVanName(e.target.value)} placeholder="Van name *" />
          <input value={vanPlate} onChange={(e) => setVanPlate(e.target.value)} placeholder="Plate (optional)" />
          {/* Who settles the fuel decides whether a driver's fill is a COST or
              only a mileage record. Get it wrong on the box truck and the P&L
              charges the same diesel twice — once as the fill, again inside the
              carrier's fortnightly invoice. */}
          <select value={vanFuel} onChange={(e) => setVanFuel(e.target.value)} style={{ minWidth: 260 }}>
            <option value="us">We pay the fuel — driver pumps, we e-transfer them</option>
            <option value="carrier">Carrier pays — billed to us with the truck</option>
          </select>
          {vanFuel === 'carrier' && (
            <input value={vanCarrier} onChange={(e) => setVanCarrier(e.target.value)}
              placeholder="Carrier name (optional)" />
          )}
          <button className="btn accent" disabled={busy === 'van'}>{busy === 'van' ? 'Adding…' : 'Add van'}</button>
        </form>
        <p className="hint">
          On a <b>carrier</b> truck the drivers still log fills — that is how we know the litres, and
          therefore the mileage — but the money stays out of the Profit tab&apos;s cost, because it is
          already inside the carrier&apos;s invoice. Record that invoice as a <b>Carrier bill</b> cost when
          it arrives.
        </p>
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
                    {/* The whole point: a new phone changes the number ON this
                        account. Adding them again makes a second driver. */}
                    <button type="button" className="disp-toggle" style={{ marginLeft: 8 }} disabled={!!busy}
                      title="They have a new phone — move their number, keep their stops and their history"
                      onClick={() => changeNumber(d.id, d.name || d.email, d.phone)}>
                      {busy === `phone${d.id}` ? 'changing…' : 'change number'}
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

        {/* An add that collided with a name we already have. The message alone
            isn't enough — the office is standing there with a new number and
            needs the thing to press. */}
        {sameName && (
          <div className="disp-linkbox">
            <b>{sameName.name} already drives for us{sameName.phone ? ` on ${sameName.phone}` : ''}.</b>
            <div className="hint" style={{ margin: '4px 0' }}>
              If this is the same person on a new phone, move their number — they keep every stop, every
              signed delivery and their pay history. Adding them again would split all of it in two.
            </div>
            <button type="button" className="btn accent" disabled={!!busy}
              onClick={() => changeNumber(sameName.id, sameName.name, sameName.phone, sameName.typed)}>
              Move {sameName.name} to {sameName.typed}
            </button>
            <button type="button" className="disp-toggle" style={{ marginLeft: 8 }}
              onClick={() => setSameName(null)}>it&apos;s a different person</button>
          </div>
        )}

        {merge && (
          <div className="disp-linkbox">
            <b>Two accounts for the same person.</b>
            <div className="hint" style={{ margin: '4px 0' }}>
              {merge.drop.name} (the duplicate) already answers on that number. Merging moves every stop,
              order and payment onto <b>{merge.keep.name}</b> and switches the duplicate off, so there is
              one column on the board and one row on the pay report again.
            </div>
            <button type="button" className="btn accent" disabled={!!busy} onClick={doMerge}>
              {busy === 'merge' ? 'merging…' : `Merge into ${merge.keep.name}`}
            </button>
            <button type="button" className="disp-toggle" style={{ marginLeft: 8 }}
              onClick={() => setMerge(null)}>not now</button>
          </div>
        )}

        {link && (
          <div className="disp-linkbox">
            <b>{link.texted ? 'Texted.' : 'Not texted — send this to them yourself:'}</b>
            <div className="disp-linkurl">{link.url}</div>
            <div className="hint" style={{ margin: '4px 0 0' }}>
              Good for 14 days and re-usable inside that window.{' '}
              {link.smsError ? `Text failed: ${link.smsError}` : 'Tapping it signs that phone in.'}
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
