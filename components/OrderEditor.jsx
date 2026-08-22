'use client';
import { useState, useRef } from 'react';
import { loadGoogleMaps, placesReady, mapsKey } from '../lib/maps';

// Post-payment order editing: contact/fulfilment, line items, and refunds.
// order/items come from the server page; inventory feeds the add-a-unit search.
// bridgedInvoice (INV- number) means money edits live on the invoice — the
// items and refund panels are replaced with a pointer there.
const fmt = (n) => '$' + (Number(n) || 0).toFixed(2);
const PAID = ['confirmed', 'ready', 'out_for_delivery', 'delivered'];

export default function OrderEditor({ order, initialItems, inventory = [], bridgedInvoice = null }) {
  // ---- contact card ----
  const [c, setC] = useState({
    name: order.name || '', email: order.email || '', phone: order.phone || '',
    deliveryMethod: order.delivery_method === 'delivery' ? 'delivery' : 'pickup',
    address: order.address || '', city: order.city || '', postal: order.postal || ''
  });
  const setContact = (k) => (e) => setC((x) => ({ ...x, [k]: e.target.value }));

  // ---- items card ----
  const [items, setItems] = useState(initialItems.map((it) => ({
    sku: it.sku || '', title: it.title || '', price: String(it.price ?? ''), cost: it.cost ?? null
  })));
  const [q, setQ] = useState('');

  // ---- refund card ----
  const [refundSel, setRefundSel] = useState({});

  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const acDone = useRef(false);
  const hasMaps = !!mapsKey();

  async function attachAutocomplete(e) {
    if (acDone.current) return;
    const input = e.currentTarget;
    await loadGoogleMaps();
    const places = await placesReady();
    if (acDone.current || !places || !input) return;
    acDone.current = true;
    try {
      const ac = new places.Autocomplete(input, { componentRestrictions: { country: 'ca' }, fields: ['address_components'], types: ['address'] });
      ac.addListener('place_changed', () => {
        const comps = ac.getPlace()?.address_components || [];
        const get = (type, short) => comps.find((x) => x.types.includes(type))?.[short ? 'short_name' : 'long_name'] || '';
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const town = get('locality') || get('postal_town') || get('sublocality_level_1') || '';
        const code = get('postal_code', true);
        setC((x) => ({ ...x, address: street || x.address, city: town || x.city, postal: code || x.postal }));
      });
    } catch { acDone.current = false; }
  }

  async function post(action, payload, busyKey) {
    setBusy(busyKey); setErr(''); setNotice('');
    try {
      const res = await fetch('/api/admin/order-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: order.order_number, action, ...payload })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Update failed.'); return null; }
      return d;
    } catch {
      setErr('Network error — please try again.');
      return null;
    } finally {
      setBusy('');
    }
  }

  async function saveContact() {
    const d = await post('contact', c, 'contact');
    if (d) setNotice('Contact & fulfilment saved.');
  }

  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const removeRow = (i) => setItems((xs) => xs.filter((_, j) => j !== i));
  const addRow = () => setItems((xs) => [...xs, { sku: '', title: '', price: '' }]);
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = q.trim().length >= 2
    ? inventory.filter((u) => tokens.every((t) => u.search.includes(t)) && !items.some((it) => it.sku === u.id)).slice(0, 8)
    : [];
  function pickInventory(u) {
    setItems((xs) => [...xs, { sku: u.id, title: u.description, price: String(u.price) }]);
    setQ('');
  }

  const fee = Math.max(0, (Number(order.total) - Number(order.subtotal) - Number(order.hst)) || 0);
  const hasHst = Number(order.hst) > 0;
  const subtotal = items.reduce((a, it) => a + (Number(it.price) || 0), 0);
  const hst = hasHst ? (subtotal + fee) * 0.13 : 0;
  const total = subtotal + fee + hst;

  async function saveItems() {
    const d = await post('items', { items: items.map((it) => ({ sku: it.sku || null, title: it.title, price: Number(it.price), cost: it.cost })) }, 'items');
    if (d) {
      setNotice(`Items saved — new total ${fmt(d.total)}.` +
        (d.relisted ? ` ${d.relisted} removed unit(s) are back on the site.` : '') +
        (d.soldAdded ? ` ${d.soldAdded} added unit(s) marked sold.` : ''));
    }
  }

  const paid = PAID.includes(order.status);
  const editable = !['cancelled', 'refunded'].includes(order.status);
  const refundSkus = Object.keys(refundSel).filter((s) => refundSel[s]);

  async function doRefund(all) {
    const label = all ? 'the ENTIRE order' : `${refundSkus.length} unit(s)`;
    if (!window.confirm(`Refund ${label} on ${order.order_number}? Refunded units go back on sale and the money comes off your revenue.`)) return;
    const d = await post('refund', { skus: all ? [] : refundSkus }, all ? 'refund-all' : 'refund');
    if (d) {
      setNotice(d.fullyRefunded
        ? `Refunded in full (−${fmt(d.refundAmount)}). ${d.relisted} unit(s) relisted. Reload to see the updated order.`
        : `Refunded ${d.refundedItems} unit(s) (−${fmt(d.refundAmount)}). ${d.relisted} relisted. Reload to see the updated order.`);
      setRefundSel({});
    }
  }

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {notice && <div className="notice-box">{notice}</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Contact & fulfilment</h2>
        <div className="form-2col">
          <div className="field"><label>Customer name</label><input value={c.name} onChange={setContact('name')} /></div>
          <div className="field"><label>Email</label><input type="email" value={c.email} onChange={setContact('email')} /></div>
        </div>
        <div className="form-2col">
          <div className="field"><label>Phone</label><input value={c.phone} onChange={setContact('phone')} /></div>
          <div className="field">
            <label>Fulfilment</label>
            <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input type="radio" name="oedm" style={{ width: 'auto' }} checked={c.deliveryMethod === 'pickup'} onChange={() => setC((x) => ({ ...x, deliveryMethod: 'pickup' }))} /> Pickup
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input type="radio" name="oedm" style={{ width: 'auto' }} checked={c.deliveryMethod === 'delivery'} onChange={() => setC((x) => ({ ...x, deliveryMethod: 'delivery' }))} /> Delivery
              </label>
            </div>
          </div>
        </div>
        {c.deliveryMethod === 'delivery' && (
          <>
            <div className="field">
              <label>Street address</label>
              <input onFocus={attachAutocomplete} autoComplete="off" value={c.address} onChange={setContact('address')} placeholder={hasMaps ? 'Start typing the street address…' : 'Street address'} />
            </div>
            <div className="form-2col">
              <div className="field"><label>City</label><input value={c.city} onChange={setContact('city')} /></div>
              <div className="field"><label>Postal code</label><input value={c.postal} onChange={setContact('postal')} /></div>
            </div>
          </>
        )}
        <p className="hint" style={{ marginTop: 4 }}>
          Contact changes never touch the money. Switching pickup↔delivery here doesn&apos;t add or remove a delivery
          charge — adjust the line items if the price should change.
        </p>
        <button className="btn accent" disabled={!!busy} onClick={saveContact}>{busy === 'contact' ? 'Saving…' : 'Save contact & fulfilment'}</button>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Line items</h2>
        {bridgedInvoice ? (
          <p className="hint" style={{ marginTop: 0 }}>
            This order was created from invoice <b>{bridgedInvoice}</b> — edit or refund that invoice instead
            (<a href="/admin/invoices" style={{ textDecoration: 'underline' }}>Invoices</a>) and it keeps this order in sync.
          </p>
        ) : !editable ? (
          <p className="hint" style={{ marginTop: 0 }}>A {order.status} order can&apos;t be edited.</p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              {paid
                ? 'This order is paid: removing a unit puts it back on sale, adding one marks it sold, and the totals recompute.'
                : 'This order is awaiting payment: item changes swap which units are held for the customer.'}
              {fee > 0 && <> The {fmt(fee)} delivery fee stays on the order.</>}
            </p>
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
            </div>
            {items.map((it, i) => (
              <div key={i} className="inv-line">
                {it.sku ? <span className="pill inv-tag" style={{ fontFamily: 'monospace' }}>{it.sku}</span> : <span className="pill inv-tag">ad-hoc</span>}
                <input className="inv-desc" value={it.title} onChange={(e) => setItem(i, 'title', e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Line description" />
                <input className="inv-amt" type="number" inputMode="decimal" min="0" step="0.01" value={it.price} onChange={(e) => setItem(i, 'price', e.target.value)} placeholder="price" />
                <button type="button" className="btn inv-del" onClick={() => removeRow(i)} aria-label="Remove line">×</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={addRow}>+ Add ad-hoc line</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                Subtotal {fmt(subtotal)}{fee > 0 ? ` · Delivery ${fmt(fee)}` : ''}{hasHst ? ` · HST ${fmt(hst)}` : ''} · <b style={{ color: 'var(--charcoal)' }}>New total {fmt(total)}</b>
                <span style={{ marginLeft: 8 }}>(was {fmt(order.total)})</span>
              </div>
              <button className="btn accent" disabled={!!busy} onClick={saveItems}>{busy === 'items' ? 'Saving…' : 'Save line items'}</button>
            </div>
          </>
        )}
      </div>

      {!bridgedInvoice && paid && (
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Refund</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Tick the unit(s) coming back for a partial refund, or refund the whole order. Refunded units are
            relisted for sale and the money comes off your dashboard revenue.
          </p>
          {initialItems.filter((it) => it.sku).map((it) => (
            <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 6, fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!refundSel[it.sku]} onChange={(e) => setRefundSel((s) => ({ ...s, [it.sku]: e.target.checked }))} />
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.sku}</span> {it.title} — {fmt(it.price)}
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!!busy || refundSkus.length === 0} onClick={() => doRefund(false)}>
              {busy === 'refund' ? 'Refunding…' : `Refund ${refundSkus.length || ''} selected unit(s)`}
            </button>
            <button className="btn danger" disabled={!!busy} onClick={() => doRefund(true)}>
              {busy === 'refund-all' ? 'Refunding…' : 'Refund entire order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
