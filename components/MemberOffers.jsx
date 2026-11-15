'use client';
import { useState } from 'react';
import { money } from '../lib/constants';
import { addToCart } from '../lib/cart';

// A reseller's offers: make one on a unit in stock, see the answers, take a counter, and add an accepted unit
// to the order. The server decides every price and refuses anything under the floor; nothing here is trusted.
export default function MemberOffers({ units, initial }) {
  const [offers, setOffers] = useState(initial);
  const [sku, setSku] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const unit = units.find((u) => u.id === sku);

  async function refresh() {
    const r = await fetch('/api/account/offers', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (d.offers) setOffers(d.offers);
  }
  async function send(e) {
    e.preventDefault(); setMsg(''); setBusy(true);
    try {
      const r = await fetch('/api/account/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, amount: Number(amount), note }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send your offer.');
      setSku(''); setAmount(''); setNote(''); setMsg('Offer sent. We will answer by email, usually within a business day.');
      await refresh();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  async function act(id, action) {
    setMsg('');
    const r = await fetch('/api/account/offers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(d.error || 'Could not do that.');
    await refresh();
  }
  const label = { open: 'Waiting for an answer', countered: 'We made a counter-offer', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired', purchased: 'Bought' };

  return (
    <div>
      <form className="panel" onSubmit={send}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Unit
          <select value={sku} onChange={(e) => setSku(e.target.value)} required style={{ display: 'block', width: '100%', marginTop: 4 }}>
            <option value="">Choose a unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.title} · {u.id} · your price {money(u.price)}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ fontWeight: 600 }}>Your offer ($, before tax)
            <input type="number" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ display: 'block', marginTop: 4, width: 150 }} />
          </label>
          <label style={{ fontWeight: 600, flex: 1, minWidth: 200 }}>Note (optional)
            <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} style={{ display: 'block', marginTop: 4, width: '100%' }} placeholder="e.g. taking three this month" />
          </label>
          <button className="btn" disabled={busy || !sku}>Send offer</button>
        </div>
        {unit && <p className="hint" style={{ marginBottom: 0 }}>Your price today is {money(unit.price)}. An accepted offer holds the unit for you for 4 hours at the agreed price, and the order must be paid within 12 hours of checkout.</p>}
      </form>
      {msg && <div className="hint" role="status" style={{ margin: '8px 0' }}>{msg}</div>}
      {offers.map((o) => (
        <div className="panel" key={o.id} style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <b>{o.title || o.sku}</b><span className="status-chip">{label[o.status] || o.status}</span>
          </div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            You offered {money(Number(o.amount))}
            {o.agreed_price != null && ['countered', 'accepted', 'purchased'].includes(o.status) && <> · agreed price <b>{money(Number(o.agreed_price))}</b></>}
            {o.status === 'accepted' && o.expires_at && <> · held until {new Date(o.expires_at).toLocaleString('en-CA')}</>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {o.status === 'accepted' && <a className="btn" href="/cart" onClick={() => addToCart(o.sku)}>Add to order &amp; check out</a>}
            {o.status === 'countered' && <button className="btn" onClick={() => act(o.id, 'accept_counter')}>Take {money(Number(o.agreed_price))}</button>}
            {['open', 'countered', 'accepted'].includes(o.status) && <button className="btn" onClick={() => act(o.id, 'withdraw')}>Withdraw</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
