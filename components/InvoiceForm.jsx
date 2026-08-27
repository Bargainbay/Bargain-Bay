'use client';
import { useState, useRef } from 'react';
import { loadGoogleMaps, placesReady, mapsKey } from '../lib/maps';
import InvoiceLines, { blankItem, toPayload } from './InvoiceLines';
import TaxMode, { previewTotals } from './TaxMode';
import { toInclusiveLines, exTaxOf, inclusiveOf } from '../lib/tax';

const SERVICES = ['Installation', 'Delivery', 'Door Removal'];
// Business days run on Toronto time (same as the dashboard's buckets).
const todayToronto = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

export default function InvoiceForm({ inventory = [], customers = [], hideCost = false }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [q, setQ] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  // 'exclusive' | 'inclusive' — how to read the amounts in the boxes. Every sale
  // here carries HST; the only question is whether it's already in the price.
  const [taxMode, setTaxMode] = useState('exclusive');
  const addHst = true;
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

  // Signed amounts, exactly as the lines are stored (a credit line is negative).
  const signed = toPayload(items).map((it) => Number(it.amount) || 0);
  const preview = previewTotals(signed, taxMode);
  const { subtotal, hst, total } = preview;

  // Switching between before-tax and tax-in re-reads the numbers already typed,
  // so it's a way of reading the boxes rather than something you have to set
  // first and remember. Credit lines are converted too — a discount quoted
  // tax-in is tax-in as well.
  function changeTaxMode(next) {
    // Read the current mode straight from state, not from inside a setTaxMode
    // updater: an updater has to be pure, and React runs it twice in dev —
    // which would convert the amounts twice.
    const prev = taxMode;
    if (next !== prev) {
      setItems((xs) => {
        const amounts = xs.map((it) => Number(it.amount) || 0);
        const converted = next === 'inclusive'
          ? toInclusiveLines(amounts)
          : amounts.map((n) => exTaxOf(n));
        return xs.map((it, i) => (it.amount === '' ? it : { ...it, amount: converted[i].toFixed(2) }));
      });
    }
    setTaxMode(next);
  }
  const fmt = (n) => '$' + n.toFixed(2);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setDone(null);
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, items: toPayload(items), addHst, taxInclusive: taxMode === 'inclusive',
          daysUntilDue, memo, deliveryMethod, address, city, postal, phone, sendEmail, invoiceDate })
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
        {done.orderNumber && (
          <div style={{ marginTop: 6 }}>
            Order <b>{done.orderNumber}</b> is on the board to fulfil, the sale is on today&apos;s
            revenue, and the unit is off the website. Mark the invoice paid when the money lands.
          </div>
        )}
        {done.contested?.length > 0 && (
          <div className="error-box" style={{ marginTop: 8 }}>
            Heads up — {done.contested.join(', ')} {done.contested.length === 1 ? 'was' : 'were'} already
            held by another order or invoice, so {done.contested.length === 1 ? 'it isn\u2019t' : 'they aren\u2019t'} reserved
            for this one. Check before you promise it.
          </div>
        )}
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

      <InvoiceLines items={items} setItems={setItems} services={SERVICES} showCost={!hideCost} />

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 12px' }}>
        <TaxMode mode={taxMode} onChange={changeTaxMode} preview={preview} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
          title="Backdate for a sale you rang up late. Revenue counts on THIS date — the day the sale was made — not the day the money clears.">
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
        <div className="hint" style={{ marginTop: 0 }}>A matching <b>{deliveryMethod}</b> order goes onto the Operations board as soon as you create this invoice — so you can schedule it on a deposit — and its units come off the website straight away.</div>
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
          {/* In tax-in mode the rep typed the total, so show it back to them —
              the subtotal beside it is the part they never keyed. */}
          {taxMode === 'inclusive' && <span> — the {fmt(preview.quoted)} you typed</span>}
        </div>
        <button className="btn accent" disabled={busy}>{busy ? 'Creating…' : (sendEmail ? 'Create & send invoice' : 'Create invoice')}</button>
      </div>
    </form>
  );
}
