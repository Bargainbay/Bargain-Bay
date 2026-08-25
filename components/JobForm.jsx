'use client';
import { useState, useRef } from 'react';
import { loadGoogleMaps, placesReady, mapsKey } from '../lib/maps';

// Putting a job on the board, usually while the customer is still on the phone.
// Address is the only required field — everything else can be filled in later,
// and forcing it up front is how you end up back on paper.
const WINDOWS = [
  { key: 'am', label: 'Morning · 8–12' },
  { key: 'pm', label: 'Afternoon · 12–4' },
  { key: 'eve', label: 'Evening · 4–8' },
  { key: 'allday', label: 'Any time · 8–8' },
  { key: 'custom', label: 'Custom…' }
];

export default function JobForm({ date, clients = [], drivers = [], canManageClients, onDone }) {
  const [type, setType] = useState('delivery');
  const [clientId, setClientId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [jobDate, setJobDate] = useState(date || '');
  const [windowKey, setWindowKey] = useState('allday');
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('12:00');
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
          windowKey: windowKey === 'custom' ? null : windowKey,
          windowStart: windowKey === 'custom' ? windowStart : null,
          windowEnd: windowKey === 'custom' ? windowEnd : null,
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
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Us / no client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clients.length === 0 && canManageClients && (
            <div className="hint">No clients set up yet — add them under Operations.</div>
          )}
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

      <div className="field">
        <label>What&apos;s going / what&apos;s the call</label>
        <input value={what} onChange={(e) => setWhat(e.target.value)}
          placeholder="Whirlpool fridge, Maytag washer — separate with commas" />
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Day</label>
          <input style={{ width: 165 }} type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Delivery window</label>
          <select style={{ width: 190 }} value={windowKey} onChange={(e) => setWindowKey(e.target.value)}>
            {WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </div>
        {windowKey === 'custom' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>From / to</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ width: 110 }} type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              <input style={{ width: 110 }} type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
          </div>
        )}
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
