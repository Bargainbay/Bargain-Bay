'use client';
import { useState } from 'react';
import { money } from '../lib/constants';
import HoneypotField, { HONEYPOT_FIELD } from './HoneypotField';

// "Make an offer" on the product page. Anyone can; the server checks the price against a floor nobody sees and says only
// "too low". A guest's offer waits for them to confirm their email before it reaches us. Signed-in resellers go through
// the member path automatically (same endpoint), so their own price and identity are used.
export default function MakeOffer({ sku, price }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: '', name: '', email: '', phone: '', note: '' });
  const [hp, setHp] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function send(e) {
    e.preventDefault(); setMsg(''); setBusy(true);
    try {
      const r = await fetch('/api/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, amount: Number(f.amount), sku, [HONEYPOT_FIELD]: hp }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send your offer.');
      setDone(d.check === 'email' ? 'We sent you an email. Open it and confirm your address, then we will look at your offer.' : 'Offer sent. We will answer by email, usually within a business day.');
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }

  if (done) return <div className="hint" role="status" style={{ marginTop: 10 }}>{done}</div>;
  if (!open) return <button type="button" className="btn block" style={{ marginTop: 8, background: 'transparent', color: 'var(--charcoal)', border: '1.5px solid var(--charcoal)' }} onClick={() => setOpen(true)}>Make an offer</button>;
  return (
    <form onSubmit={send} className="panel" style={{ marginTop: 10 }}>
      <b>Make an offer</b>
      <p className="hint" style={{ margin: '4px 0 10px' }}>Listed at {money(price)}. Tell us what you would pay (before tax). We may accept, counter, or pass; no hard feelings either way.</p>
      <HoneypotField value={hp} onChange={setHp} />
      <label style={{ display: 'block', fontWeight: 600 }}>Your offer ($)
        <input type="number" step="0.01" min="1" required value={f.amount} onChange={set('amount')} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label style={{ display: 'block', fontWeight: 600, marginTop: 8 }}>Name
        <input type="text" required maxLength={80} value={f.name} onChange={set('name')} autoComplete="name" style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label style={{ display: 'block', fontWeight: 600, marginTop: 8 }}>Email
        <input type="email" required value={f.email} onChange={set('email')} autoComplete="email" style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label style={{ display: 'block', fontWeight: 600, marginTop: 8 }}>Phone
        <input type="tel" required value={f.phone} onChange={set('phone')} autoComplete="tel" style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      <label style={{ display: 'block', fontWeight: 600, marginTop: 8 }}>Note (optional)
        <input type="text" maxLength={500} value={f.note} onChange={set('note')} style={{ display: 'block', width: '100%', marginTop: 4 }} /></label>
      {msg && <div className="error-box" role="alert" style={{ marginTop: 8 }}>{msg}</div>}
      <button className="btn block" style={{ marginTop: 10 }} disabled={busy}>Send offer</button>
    </form>
  );
}
