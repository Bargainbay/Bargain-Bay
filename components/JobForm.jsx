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

export default function JobForm({ date, clients = [], drivers = [], canManageClients, onDone, onClientAdded, job = null }) {
  // Same form, two jobs: adding a stop, and correcting one that exists. Editing
  // reuses this rather than growing a second form that drifts — the fields, the
  // address autocomplete and the client picker are all already here.
  const editing = !!job;
  const [type, setType] = useState(job?.type || 'delivery');
  const [clientId, setClientId] = useState(job?.clientId ? String(job.clientId) : '');
  const [newClient, setNewClient] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [customerName, setCustomerName] = useState(job?.customerName || '');
  const [phone, setPhone] = useState(job?.phone || '');
  const [email, setEmail] = useState(job?.email || '');
  const [address, setAddress] = useState(job?.address || '');
  const [city, setCity] = useState(job?.city || '');
  const [postal, setPostal] = useState(job?.postal || '');
  const [coords, setCoords] = useState({ lat: null, lng: null });
  // A transfer runs from one address to another — five pieces out of Mississauga
  // into Burlington is one job with two ends, and the driver needs both.
  const [isTransfer, setIsTransfer] = useState(!!job?.pickupAddress);
  const [pickupAddress, setPickupAddress] = useState(job?.pickupAddress || '');
  const [pickupCity, setPickupCity] = useState(job?.pickupCity || '');
  const [pickupPostal, setPickupPostal] = useState(job?.pickupPostal || '');
  const [chargeAmount, setChargeAmount] = useState(job?.chargeAmount == null ? '' : String(job.chargeAmount));
  const [jobDate, setJobDate] = useState((editing ? job.jobDate : date) || '');
  const [windowStart, setWindowStart] = useState(job?.windowStart || '');
  const [windowEnd, setWindowEnd] = useState(job?.windowEnd || '');
  const [shipmentType, setShipmentType] = useState(job?.shipmentType || '');
  const [services, setServices] = useState(job?.services || []);
  const toggleService = (k) => setServices((xs) => (xs.includes(k) ? xs.filter((v) => v !== k) : [...xs, k]));
  const [appliance, setAppliance] = useState(job?.appliance || '');
  // Service calls are either against something WE sold — in which case the
  // order tells us the customer, the address and the unit — or for an outside
  // client, where it's all typed. Defaults to ours; that's the common case.
  const [who, setWho] = useState('bb');
  const [custQ, setCustQ] = useState('');
  const [custHits, setCustHits] = useState([]);
  const [picked, setPicked] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [issue, setIssue] = useState(job?.issue || '');
  const [driverId, setDriverId] = useState(job?.driverId ? String(job.driverId) : '');
  const [what, setWhat] = useState((job?.items || []).map((i) => i.description).join(', '));
  const [notes, setNotes] = useState(job?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const acDone = useRef(new Set());
  const hasMaps = !!mapsKey();

  // Attach Places on first focus, and keep the coordinates it hands us — that's
  // what lets routing work later without paying to geocode the address again.
  //
  // Per INPUT, not once per form: the pickup end of a transfer is a real address
  // somebody has to find, and it was being typed by hand while the drop-off got
  // autocomplete. `acDone` is a Set of the fields already wired.
  async function attachAutocomplete(e, which = 'drop') {
    const input = e.currentTarget;
    if (acDone.current.has(which)) return;
    await loadGoogleMaps();
    const places = await placesReady();
    if (acDone.current.has(which) || !places || !input) return;
    acDone.current.add(which);
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
        if (which === 'pickup') {
          if (street) setPickupAddress(street);
          if (town) setPickupCity(town);
          if (code) setPickupPostal(code);
          return;                       // routing geocodes from the drop-off
        }
        if (street) setAddress(street);
        if (town) setCity(town);
        if (code) setPostal(code);
        const loc = place?.geometry?.location;
        if (loc) setCoords({ lat: loc.lat(), lng: loc.lng() });
      });
    } catch { acDone.current.delete(which); }
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

  // Find a past buyer by name, email, phone or BB number.
  async function searchCustomers(q) {
    setCustQ(q);
    if (q.trim().length < 2) { setCustHits([]); return; }
    try {
      const d = await fetch(`/api/admin/dispatch?view=customers&q=${encodeURIComponent(q)}`).then((r) => r.json());
      setCustHits(d.customers || []);
    } catch { setCustHits([]); }
  }

  // Picking the buyer loads their purchases to choose from.
  async function pickCustomer(c) {
    setPicked(c); setCustHits([]); setCustQ('');
    setCustomerName(c.name || ''); setPhone(c.phone || '');
    setEmail(c.email || '');
    if (c.address) setAddress(c.address);
    if (c.city) setCity(c.city);
    if (c.postal) setPostal(c.postal);
    try {
      const d = await fetch(`/api/admin/dispatch?view=orders&email=${encodeURIComponent(c.email)}`).then((r) => r.json());
      setOrders(d.orders || []);
    } catch { setOrders([]); }
  }

  // Picking the order fills the address it went to and names the unit.
  function pickOrder(id) {
    setOrderId(id);
    const o = orders.find((x) => String(x.id) === String(id));
    if (!o) return;
    if (o.address) setAddress(o.address);
    if (o.city) setCity(o.city);
    if (o.postal) setPostal(o.postal);
    if (o.phone) setPhone(o.phone);
    if (o.name) setCustomerName(o.name);
    if (!appliance && o.items?.length) setAppliance(o.items.map((i) => i.title).join(', '));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { action: 'edit', jobId: job.id } : {}),
          type, clientId: clientId || null, customerName, phone, email,
          address, city, postal, lat: coords.lat, lng: coords.lng,
          jobDate: jobDate || null,
          windowStart: windowStart || null,
          windowEnd: windowEnd || null,
          shipmentType: shipmentType || null, services, appliance, issue,
          pickupAddress: isTransfer ? pickupAddress : null,
          pickupCity: isTransfer ? pickupCity : null,
          pickupPostal: isTransfer ? pickupPostal : null,
          chargeAmount: chargeAmount === '' ? null : Number(chargeAmount),
          orderId: type === 'service_call' && who === 'bb' && orderId ? orderId : null,
          source: type === 'service_call' && who === 'bb' ? 'bargain_bay' : 'manual',
          driverId: driverId || null,
          notes,
          items: what.split(',').map((s) => s.trim()).filter(Boolean).map((d) => ({ description: d }))
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || (editing ? 'Could not save that.' : 'Could not add the job.')); return; }
      onDone?.(d.job);
    } catch {
      setErr('Network error — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>{editing ? `Edit ${job.jobNumber}` : 'New job'}</h3>
      {err && <div className="error-box">{err}</div>}

      {type === 'service_call' && (
        <div className="field">
          <label>Who is this for</label>
          <div className="svc-chips">
            <button type="button" className={'svc-chip' + (who === 'bb' ? ' is-on' : '')}
              onClick={() => setWho('bb')}>Something we sold</button>
            <button type="button" className={'svc-chip' + (who === 'ext' ? ' is-on' : '')}
              onClick={() => { setWho('ext'); setPicked(null); setOrders([]); setOrderId(''); }}>
              External client
            </button>
          </div>

          {who === 'bb' && !picked && (
            <div style={{ marginTop: 8 }}>
              <input value={custQ} onChange={(e) => searchCustomers(e.target.value)} autoComplete="off"
                placeholder="Find the customer — name, email, phone, or BB- number…" />
              {custHits.length > 0 && (
                <div className="disp-hits">
                  {custHits.map((c) => (
                    <button type="button" key={c.email} onClick={() => pickCustomer(c)}>
                      <span><strong>{c.name}</strong> <span className="hint" style={{ margin: 0 }}>· {c.email}</span></span>
                      <span className="hint" style={{ margin: 0 }}>{c.orders} order{c.orders === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </div>
              )}
              {custQ.trim().length >= 2 && custHits.length === 0 && (
                <div className="hint">Nobody matches. If they didn&apos;t buy from us, switch to External client.</div>
              )}
            </div>
          )}

          {who === 'bb' && picked && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <strong>{picked.name}</strong>
                <span className="hint" style={{ margin: 0 }}>{picked.email}</span>
                <button type="button" className="disp-toggle"
                  onClick={() => { setPicked(null); setOrders([]); setOrderId(''); }}>change</button>
              </div>
              <label style={{ fontSize: 13, fontWeight: 500 }}>Which order needs the visit</label>
              <select value={orderId} onChange={(e) => pickOrder(e.target.value)}>
                <option value="">Not tied to an order</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} · {o.date} · {o.items.map((i) => i.title).join(', ').slice(0, 60) || 'no items'}
                  </option>
                ))}
              </select>
              <div className="hint">
                {orders.length === 0
                  ? 'No orders found for them.'
                  : 'Picking one fills the address and names the unit, and ties the ticket to that sale.'}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="form-2col">
        <div className="field">
          <label>Job type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="delivery">Delivery</option>
            <option value="service_call">Service call</option>
            <option value="pickup">Pickup</option>
          </select>
        </div>
        <div className="field" style={{ display: type === 'service_call' && who === 'bb' ? 'none' : undefined }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 400, fontSize: 13.5 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={isTransfer}
            onChange={(e) => setIsTransfer(e.target.checked)} />
          Picking up from one address and dropping at another
        </label>
      </div>

      {isTransfer && (
        <div className="field">
          <label>Pick up from</label>
          <input value={pickupAddress} onFocus={(e) => attachAutocomplete(e, 'pickup')}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder={hasMaps ? 'Start typing the address we collect from…' : "Street address we're collecting from"}
            autoComplete="off" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={pickupCity} onChange={(e) => setPickupCity(e.target.value)} placeholder="City" />
            <input style={{ width: 150 }} value={pickupPostal} onChange={(e) => setPickupPostal(e.target.value)} placeholder="Postal code" />
          </div>
        </div>
      )}

      <div className="field">
        <label>{isTransfer ? 'Deliver to *' : 'Address *'}</label>
        <input required onFocus={(e) => attachAutocomplete(e, 'drop')} autoComplete="off" value={address}
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
        <label>What we&apos;re charging the client (optional)</label>
        <input type="number" min="0" step="0.01" inputMode="decimal" style={{ width: 150 }}
          value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="150.00" />
        <div className="hint">
          Leave it blank and set it later on the Billing tab. It only bills once the job is finished.
        </div>
      </div>

      <div className="field">
        <label>Access notes (optional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Buzzer 402, third floor walk-up, dog in the yard" />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => onDone?.(null)}>Cancel</button>
        <button className="btn accent" disabled={busy}>
          {busy ? 'Saving…' : (editing ? 'Save changes' : 'Add to board')}
        </button>
      </div>
      <p className="hint" style={{ textAlign: 'right' }}>
        {editing
          ? (job.orderNumber
            // Editing the JOB, not the sale. Saying so stops somebody "fixing"
            // an address here and wondering why the invoice still has the old one.
            ? `Changes here apply to this stop only — ${job.orderNumber} keeps its own details.`
            : 'Only the address is required.')
          : 'Only the address is required. Leave the day blank and it waits in “To assign”.'}
      </p>
    </form>
  );
}
