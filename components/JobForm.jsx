'use client';
import { useState, useRef } from 'react';
import { loadGoogleMaps, placesReady, mapsKey } from '../lib/maps';

// Putting a job on the board, usually while the customer is still on the phone.
// Address is the only required field — everything else can be filled in later,
// and forcing it up front is how you end up back on paper.
// The team sets the window per job and it can start at any hour, so the real
// input is two clocks. These are just one-tap fills for the common ones.
const QUICK_WINDOWS = [
  { label: '8–12', start: '08:00', end: '12:00' },
  { label: '12–4', start: '12:00', end: '16:00' },
  { label: '4–8', start: '16:00', end: '20:00' },
  { label: 'All day', start: '08:00', end: '20:00' }
];
// How far in the crew goes. The driver needs this before they get out of the van.
const SHIPMENT_TYPES = [
  ['white_glove', 'White glove', 'Into the room, unpacked and placed'],
  ['threshold', 'Threshold', 'To the door and no further']
];
// What's being done on the stop. Multi-select — one visit is routinely a
// delivery AND an install AND a haul-away.
const SERVICES = [
  ['delivery_only', 'Delivery only'], ['install', 'Install'], ['haul_away', 'Haul away'],
  ['exchange', 'Exchange / swap'], ['return_pickup', 'Return pickup'],
  ['parts_drop', 'Parts drop-off'], ['warranty', 'Warranty call']
];

export default function JobForm({ date, clients = [], drivers = [], canManageClients, onDone, onClientAdded }) {
  const [type, setType] = useState('delivery');
  const [clientId, setClientId] = useState('');
  const [newClient, setNewClient] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [jobDate, setJobDate] = useState(date || '');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [shipmentType, setShipmentType] = useState('');
  const [services, setServices] = useState([]);
  const toggleService = (k) => setServices((xs) => (xs.includes(k) ? xs.filter((v) => v !== k) : [...xs, k]));
  const [appliance, setAppliance] = useState('');
  const [issue, setIssue] = useState('');
  const [driverId, setDriverId] = useState('');
  const [what, setWhat] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const acDone = useRef(false);
  const hasMaps = !!mapsKey();

  // Attach Places on first focus, and keep the coordinates it hands us — that's
  // what lets routing work later without paying to geocode the address again.
  async function attachAutocomplete(e) {
    if (acDone.current) return;
    const input = e.currentTarget;
    await loadGoogleMaps();
    const places = await placesReady();
    if (acDone.current || !places || !input) return;
    acDone.current = true;
    try {
      const ac = new places.Autocomplete(input, {
        componentRestrictions: { country: 'ca' },
        fields: ['address_components', 'geometry'],
        types: ['address']
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const comps = place?.address_components || [];
        const get = (t, short) => comps.find((c) => c.types.includes(t))?.[short ? 'short_name' : 'long_name'] || '';
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const town = get('locality') || get('postal_town') || get('sublocality_level_1') || '';
        const code = get('postal_code', true);
        if (street) setAddress(street);
        if (town) setCity(town);
        if (code) setPostal(code);
        const loc = place?.geometry?.location;
        if (loc) setCoords({ lat: loc.lat(), lng: loc.lng() });
      });
    } catch { acDone.current = false; }
  }

  // Add a client without leaving the job you're in the middle of typing.
  async function saveClient() {
    const nm = newClient.trim();
    if (!nm) { setAddingClient(false); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'client', name: nm })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add that client.'); return; }
      onClientAdded?.(d.client);
      setClientId(String(d.client.id));
      setAddingClient(false); setNewClient('');
    } catch { setErr('Network error — the client was not added.'); }
    finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, clientId: clientId || null, customerName, phone, email,
          address, city, postal, lat: coords.lat, lng: coords.lng,
          jobDate: jobDate || null,
          windowStart: windowStart || null,
          windowEnd: windowEnd || null,
          shipmentType: shipmentType || null, services, appliance, issue,
          driverId: driverId || null,
          notes,
          items: what.split(',').map((s) => s.trim()).filter(Boolean).map((d) => ({ description: d }))
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add the job.'); return; }
      onDone?.(d.job);
    } catch {
      setErr('Network error — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>New job</h3>
      {err && <div className="error-box">{err}</div>}

      <div className="form-2col">
        <div className="field">
          <label>Job type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="delivery">Delivery</option>
            <option value="service_call">Service call</option>
            <option value="pickup">Pickup</option>
          </select>
        </div>
        <div className="field">
          <label>For which client</label>
          {addingClient ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)}
                placeholder="New client company name"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveClient(); } }} />
              <button type="button" className="btn accent" onClick={saveClient} disabled={busy}>Save</button>
              <button type="button" className="btn" onClick={() => { setAddingClient(false); setNewClient(''); }}>×</button>
            </div>
          ) : (
            <select value={clientId}
              onChange={(e) => {
                if (e.target.value === '__new') { setAddingClient(true); return; }
                setClientId(e.target.value);
              }}>
              <option value="">Us / no client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new">+ Add a new client…</option>
            </select>
          )}
          <div className="hint">
            {addingClient ? 'It’s saved and picked the moment you hit Save.' : 'New company on the phone? Add them right here.'}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Address *</label>
        <input required onFocus={attachAutocomplete} autoComplete="off" value={address}
          onChange={(e) => { setAddress(e.target.value); setCoords({ lat: null, lng: null }); }}
          placeholder={hasMaps ? 'Start typing the street address…' : 'Street address'} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          <input style={{ width: 150 }} value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Postal code" />
        </div>
        {hasMaps && (
          <div className="hint">
            Pick it from the dropdown — city and postal fill in, and it saves the map location so routing works later.
            {coords.lat ? ' ✓ Location saved.' : ''}
          </div>
        )}
      </div>

      <div className="form-2col">
        <div className="field">
          <label>Customer name</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jane Smith" />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(647) 555-0134" inputMode="tel" />
        </div>
      </div>

      {type === 'service_call' ? (
        <>
          <div className="field">
            <label>Appliance</label>
            <input value={appliance} onChange={(e) => setAppliance(e.target.value)}
              placeholder="Whirlpool WRS321SDHZ fridge" />
          </div>
          <div className="field">
            <label>Reported problem</label>
            <input value={issue} onChange={(e) => setIssue(e.target.value)}
              placeholder="Not cooling, fan noise from the back" />
            <div className="hint">Opens a service ticket. It stays open across as many visits as it takes.</div>
          </div>
        </>
      ) : (
        <div className="form-2col">
          <div className="field">
            <label>What&apos;s going</label>
            <input value={what} onChange={(e) => setWhat(e.target.value)}
              placeholder="Whirlpool fridge, Maytag washer — separate with commas" />
          </div>
          <div className="field">
            <label>Shipment type</label>
            <select value={shipmentType} onChange={(e) => setShipmentType(e.target.value)}>
              <option value="">Not set</option>
              {SHIPMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <div className="hint">
              {SHIPMENT_TYPES.find(([k]) => k === shipmentType)?.[2] || 'How far into the property the crew goes.'}
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label>Services on this stop</label>
        <div className="svc-chips">
          {SERVICES.map(([k, l]) => (
            <button key={k} type="button"
              className={'svc-chip' + (services.includes(k) ? ' is-on' : '')}
              aria-pressed={services.includes(k)}
              onClick={() => toggleService(k)}>{l}</button>
          ))}
        </div>
        <div className="hint">Tap all that apply. Anything unusual goes in the notes below.</div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Day</label>
          <input style={{ width: 165 }} type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Window we promised</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={{ width: 118 }} type="time" value={windowStart} aria-label="Window start"
              onChange={(e) => setWindowStart(e.target.value)} />
            <span style={{ color: 'var(--muted)' }}>to</span>
            <input style={{ width: 118 }} type="time" value={windowEnd} aria-label="Window end"
              onChange={(e) => setWindowEnd(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
            {QUICK_WINDOWS.map((w) => (
              <button key={w.label} type="button" className="btn" style={{ padding: '3px 9px', fontSize: 11.5 }}
                onClick={() => { setWindowStart(w.start); setWindowEnd(w.end); }}>{w.label}</button>
            ))}
            {(windowStart || windowEnd) && (
              <button type="button" className="btn" style={{ padding: '3px 9px', fontSize: 11.5 }}
                onClick={() => { setWindowStart(''); setWindowEnd(''); }}>Clear</button>
            )}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Driver (optional)</label>
          <select style={{ width: 175 }} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Assign later</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Access notes (optional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Buzzer 402, third floor walk-up, dog in the yard" />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => onDone?.(null)}>Cancel</button>
        <button className="btn accent" disabled={busy}>{busy ? 'Adding…' : 'Add to board'}</button>
      </div>
      <p className="hint" style={{ textAlign: 'right' }}>
        Only the address is required. Leave the day blank and it waits in &ldquo;To assign&rdquo;.
      </p>
    </form>
  );
}
