'use client';
import { useState, useRef } from 'react';
import { loadGoogleMaps, placesReady, mapsKey } from '../lib/maps';

// Product lines default to a 1-year warranty (downgrade per item as needed).
const blankItem = () => ({ description: '', amount: '', kind: 'unit', warrantyMonths: 12, cost: '' });
const serviceItem = (description) => ({ description, amount: '', kind: 'service', warrantyMonths: null });
const SERVICES = ['Installation', 'Delivery', 'Door Removal'];
// Business days run on Toronto time (same as the dashboard's buckets).
const todayToronto = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

export default function InvoiceForm({ inventory = [], customers = [], hideCost = false }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [q, setQ] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const [addHst, setAddHst] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [daysUntilDue, setDaysUntilDue] = useState(14);
  const [invoiceDate, setInvoiceDate] = useState(todayToronto());
  const [memo, setMemo] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const acDone = useRef(false);
  const hasMaps = !!mapsKey();

  // Attach Google Places autocomplete the first time the address field is focused.
  // Uses the focused input directly (e.currentTarget) and polls until the async
  // Places library is actually ready — robust against the load timing that broke
  // a mount-time effect. No-op without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
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
        fields: ['address_components'],
        types: ['address']
      });
      ac.addListener('place_changed', () => {
        const comps = ac.getPlace()?.address_components || [];
        const get = (type, short) => comps.find((c) => c.types.includes(type))?.[short ? 'short_name' : 'long_name'] || '';
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const town = get('locality') || get('postal_town') || get('sublocality_level_1') || '';
        const code = get('postal_code', true);
        if (street) setAddress(street);
        if (town) setCity(town);
        if (code) setPostal(code);
      });
    } catch { acDone.current = false; }
  }

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addRow = () => setItems((xs) => [...xs, blankItem()]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));
  // Add a service line (Installation/Delivery/Door Removal) — no SKU, no warranty,
  // never touches inventory. Reuses the first empty row if there is one.
  const addService = (label) => setItems((xs) => {
    const empty = xs.findIndex((it) => !it.description && !it.amount);
    const li = serviceItem(label);
    return empty >= 0 ? xs.map((it, j) => (j === empty ? li : it)) : [...xs, li];
  });

  // Every query word must appear somewhere in the unit's text, so multi-word
  // searches like "kitchenaid dishwasher" match (brand and type sit far apart
  // in the string; a plain substring match needs the whole phrase contiguous).
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = q.trim().length >= 2
    ? inventory.filter((u) => tokens.every((t) => u.search.includes(t))).slice(0, 8)
    : [];

  const custQuery = (email || name).trim().toLowerCase();
  const custMatches = custOpen && custQuery.length >= 2
    ? customers.filter((c) => c.search.includes(custQuery) && c.email.toLowerCase() !== email.trim().toLowerCase()).slice(0, 6)
    : [];
  // Fill the whole contact from the client database — phone and the last known
  // delivery address too (the address fields show once Delivery is selected).
  function pickCustomer(c) {
    setName(c.name || '');
    setEmail(c.email || '');
    if (c.phone) setPhone(c.phone);
    if (c.address) setAddress(c.address);
    if (c.city) setCity(c.city);
    if (c.postal) setPostal(c.postal);
    setCustOpen(false);
  }
  function pickInventory(u) {
    // Keep the SKU on the line so the server can delist the unit when paid.
    const filled = { description: u.description, amount: String(u.price), sku: u.id, kind: 'unit', warrantyMonths: 12 };
    setItems((xs) => {
      const empty = xs.findIndex((it) => !it.description && !it.amount);
      return empty >= 0 ? xs.map((it, j) => (j === empty ? filled : it)) : [...xs, filled];
    });
    setQ('');
  }

  const subtotal = items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const hst = addHst ? subtotal * 0.13 : 0;
  const total = subtotal + hst;
  const fmt = (n) => '$' + n.toFixed(2);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, items, addHst, daysUntilDue, memo, deliveryMethod, address, city, postal, phone, sendEmail, invoiceDate })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not create the invoice.'); return; }
      setDone(d.invoice);
      setName(''); setEmail(''); setItems([blankItem()]); setMemo(''); setInvoiceDate(todayToronto());
      setDeliveryMethod('pickup'); setAddress(''); setCity(''); setPostal(''); setPhone('');
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice-box" style={{ lineHeight: 1.6 }}>
        ✓ Invoice <b>{done.number}</b> for <b>{fmt(done.total)}</b>{' '}
        {done.emailed ? <>emailed to <b>{done.email}</b> with e-transfer instructions.</> : <>created (<b>not emailed</b>) — for <b>{done.email}</b>.</>}
        {done.hostedUrl && <> <a href={done.hostedUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>View invoice →</a></>}
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setDone(null)}>Create another</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-box">{err}</div>}
      <div className="form-2col">
        <div className="field">
          <label>Customer name</label>
          <input value={name} onChange={(e) => { setName(e.target.value); setCustOpen(true); }} placeholder="Jane Smith" />
        </div>
        <div className="field">
          <label>Customer email *</label>
          <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setCustOpen(true); }} placeholder="jane@example.com" autoComplete="off" />
        </div>
      </div>
      {custMatches.length > 0 && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, margin: '-6px 0 12px', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 11px', borderBottom: '1px solid var(--line-soft)' }}>Existing customers</div>
          {custMatches.map((c) => (
            <button type="button" key={c.email} onClick={() => pickCustomer(c)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
              <span>{c.name || '(no name)'}<span style={{ color: 'var(--muted)' }}> · {c.email}</span>
                {c.address ? <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{[c.address, c.city].filter(Boolean).join(', ')}</span> : null}</span>
              <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{c.phone || ''}</span>
            </button>
          ))}
        </div>
      )}

      {inventory.length > 0 && (
        <div className="field">
          <label>Add from inventory</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your stock by model, name, or SKU…" />
          {matches.length > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, maxHeight: 230, overflowY: 'auto' }}>
              {matches.map((u) => (
                <button type="button" key={u.id} onClick={() => pickInventory(u)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span>{u.description}</span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>${u.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="hint">Picking a unit fills a line below with its name, SKU, and price — you can still edit the amount.</div>
        </div>
      )}

      <label style={{ fontSize: 13, fontWeight: 500, display: 'block', margin: '4px 0 6px' }}>Line items</label>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input style={{ flex: 1 }} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder={it.kind === 'service' ? 'Service description' : 'e.g. Whirlpool WRS321SDHZ refrigerator'} />
          {it.kind === 'service' ? (
            <span className="pill" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Service</span>
          ) : (
            <select value={it.warrantyMonths == null ? '' : it.warrantyMonths} onChange={(e) => setItem(i, 'warrantyMonths', e.target.value === '' ? null : Number(e.target.value))}
              title="Warranty term shown on the invoice" style={{ width: 120, fontSize: 12.5, padding: '4px 6px' }}>
              <option value={24}>2-yr warranty</option>
              <option value={12}>1-yr warranty</option>
              <option value={6}>6-mo warranty</option>
              <option value={3}>3-mo warranty</option>
              <option value="">No warranty</option>
            </select>
          )}
          {it.kind !== 'service' && !it.sku && !hideCost && (
            <input style={{ width: 95 }} type="number" min="0" step="0.01" value={it.cost ?? ''} onChange={(e) => setItem(i, 'cost', e.target.value)} placeholder="cost" title="Your cost for this unit (for margin) — fill in for a unit that isn't in inventory" />
          )}
          <input style={{ width: 110 }} type="number" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} placeholder="price" />
          <button type="button" className="btn" style={{ padding: '0 12px' }} onClick={() => removeRow(i)} aria-label="Remove line">×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" className="btn" onClick={addRow}>+ Add line</button>
        <span className="hint" style={{ margin: '0 0 0 4px' }}>Add a service:</span>
        {SERVICES.map((s) => (
          <button key={s} type="button" className="btn" style={{ fontSize: 12.5 }} onClick={() => addService(s)}>+ {s}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={addHst} onChange={(e) => setAddHst(e.target.checked)} /> Add 13% HST
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
          title="Backdate for a sale you rang up late — the invoice shows this date and the due date counts from it. When you mark it paid, set the paid date too so revenue lands on the right day.">
          Invoice date
          <input style={{ width: 150 }} type="date" max={todayToronto()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          Due in
          <input style={{ width: 70 }} type="number" min="1" max="90" value={daysUntilDue} onChange={(e) => setDaysUntilDue(e.target.value)} /> days
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email this invoice to the customer
        </label>
      </div>

      <div className="field">
        <label>Fulfilment</label>
        <div style={{ display: 'flex', gap: 18, margin: '2px 0 6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400 }}>
            <input type="radio" name="dm" style={{ width: 'auto' }} checked={deliveryMethod === 'pickup'} onChange={() => setDeliveryMethod('pickup')} /> Pickup
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400 }}>
            <input type="radio" name="dm" style={{ width: 'auto' }} checked={deliveryMethod === 'delivery'} onChange={() => setDeliveryMethod('delivery')} /> Delivery
          </label>
        </div>
        <div className="hint" style={{ marginTop: 0 }}>When you mark this invoice paid, a matching <b>{deliveryMethod}</b> order is created in Operations to fulfil.</div>
        {deliveryMethod === 'delivery' && (
          <div style={{ marginTop: 8 }}>
            <input onFocus={attachAutocomplete} autoComplete="off" style={{ marginBottom: 8 }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={hasMaps ? 'Start typing the street address…' : 'Street address'} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              <input style={{ width: 150 }} value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Postal code" />
            </div>
            {hasMaps && <div className="hint" style={{ marginTop: 4 }}>Pick the address from the dropdown and the city + postal fill in automatically.</div>}
          </div>
        )}
        <input style={{ marginTop: 8 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Customer phone (optional)" />
      </div>

      <div className="field">
        <label>Memo / notes (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Shown on the invoice" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>
          Subtotal {fmt(subtotal)}{addHst ? ` · HST ${fmt(hst)}` : ''} · <b style={{ color: 'var(--charcoal)' }}>Total {fmt(total)}</b>
        </div>
        <button className="btn accent" disabled={busy}>{busy ? 'Creating…' : (sendEmail ? 'Create & send invoice' : 'Create invoice')}</button>
      </div>
    </form>
  );
}
