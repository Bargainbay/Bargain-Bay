'use client';
import { useState } from 'react';
import HoneypotField, { HONEYPOT_FIELD } from './HoneypotField';

const APPLIANCES = ['Refrigerator', 'Freezer', 'Washer', 'Dryer', 'Dishwasher', 'Range / Stove', 'Wall oven', 'Cooktop', 'Microwave', 'Range hood', 'Other'];
const SIZES = ['Studio / 1 room', '1 bedroom', '2 bedrooms', '3 bedrooms', '4+ bedrooms', 'Just a few items'];
const WINDOWS = [['any', 'Any time'], ['morning', 'Morning (8–12)'], ['afternoon', 'Afternoon (12–5)'], ['evening', 'Evening (5–8)']];
const ACCESS = [['ground', 'Ground floor / no stairs'], ['stairs', 'Stairs'], ['elevator', 'Elevator']];

export default function BookingForm() {
  const [kind, setKind] = useState('service');
  const [f, setF] = useState({ preferredWindow: 'any', fromAccess: 'ground', toAccess: 'ground' });
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, kind, [HONEYPOT_FIELD]: hp })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || 'Something went wrong. Please try again.');
      else setDone(j.ref);
    } catch { setError('Could not reach us — check your connection and try again.'); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="panel" role="status">
        <h2>Request received — {done}</h2>
        <p>Thank you. This is a request, not yet a confirmed appointment. Our dispatch team will contact you {kind === 'move' ? 'with your quote' : 'to confirm a time'}, and a copy has been emailed to you.</p>
      </div>
    );
  }

  const text = (k, label, props = {}) => (
    <div className="field"><label htmlFor={'bk-' + k}>{label}</label>
      <input id={'bk-' + k} value={f[k] || ''} onChange={set(k)} {...props} /></div>
  );
  const select = (k, label, opts, required = true) => (
    <div className="field"><label htmlFor={'bk-' + k}>{label}</label>
      <select id={'bk-' + k} value={f[k] || ''} onChange={set(k)} required={required}>
        {required && !f[k] && <option value="">Choose…</option>}
        {opts.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
      </select></div>
  );

  return (
    <form onSubmit={submit} className="panel">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} role="tablist">
        <button type="button" role="tab" aria-selected={kind === 'service'} className={'btn' + (kind === 'service' ? ' primary' : '')} onClick={() => setKind('service')}>Book a service call</button>
        <button type="button" role="tab" aria-selected={kind === 'move'} className={'btn' + (kind === 'move' ? ' primary' : '')} onClick={() => setKind('move')}>Get a moving quote</button>
      </div>
      <HoneypotField value={hp} onChange={(e) => setHp(e.target.value)} />

      <h2>About you</h2>
      {text('name', 'Full name', { required: true, autoComplete: 'name' })}
      {text('phone', 'Phone', { required: true, type: 'tel', autoComplete: 'tel' })}
      {text('email', 'Email', { required: true, type: 'email', autoComplete: 'email' })}

      {kind === 'service' ? (<>
        <h2>The appliance</h2>
        {select('appliance', 'Type of appliance', APPLIANCES)}
        {text('brand', 'Brand (optional)')}
        {text('model', 'Model number (optional)')}
        <div className="field"><label htmlFor="bk-issue">What is wrong with it?</label>
          <textarea id="bk-issue" rows={4} required value={f.issue || ''} onChange={set('issue')} /></div>
        <div className="field"><label><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={!!f.urgent} onChange={set('urgent')} />This is urgent (for example a fridge that has stopped cooling)</label></div>
        <h2>Where is it?</h2>
        {text('address', 'Street address', { required: true, autoComplete: 'street-address' })}
        {text('city', 'City', { required: true, autoComplete: 'address-level2' })}
        {text('postal', 'Postal code', { autoComplete: 'postal-code' })}
      </>) : (<>
        <h2>The move</h2>
        {select('size', 'Roughly how much is moving?', SIZES)}
        {text('address', 'Pick-up address', { required: true })}
        {text('fromCity', 'Pick-up city')}
        {text('fromPostal', 'Pick-up postal code')}
        {select('fromAccess', 'Access at pick-up', ACCESS, false)}
        {text('toAddress', 'Drop-off address', { required: true })}
        {text('toCity', 'Drop-off city')}
        {text('toPostal', 'Drop-off postal code')}
        {select('toAccess', 'Access at drop-off', ACCESS, false)}
        <div className="field"><label htmlFor="bk-bulky">Heavy or special items (piano, safe, appliances…)</label>
          <textarea id="bk-bulky" rows={3} value={f.bulky || ''} onChange={set('bulky')} /></div>
        <div className="field"><label><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={!!f.packing} onChange={set('packing')} />I would like packing help</label></div>
        <div className="field"><label><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={!!f.flexibleDate} onChange={set('flexibleDate')} />My date is flexible</label></div>
      </>)}

      <h2>When</h2>
      {text('preferredDate', kind === 'move' ? 'Moving date' : 'Preferred date', { type: 'date', min: today })}
      {select('preferredWindow', 'Preferred time', WINDOWS, false)}
      <div className="field"><label htmlFor="bk-note">Anything else we should know? (optional)</label>
        <textarea id="bk-note" rows={3} value={f.note || ''} onChange={set('note')} /></div>

      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : kind === 'move' ? 'Request my quote' : 'Request my service call'}</button>
      <p className="hint">We will confirm by phone or email before anything is booked.</p>
    </form>
  );
}
