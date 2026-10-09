'use client';
import { useState } from 'react';
import HoneypotField, { HONEYPOT_FIELD } from './HoneypotField';

const BLANK = {
  legalName: '', tradeName: '', businessNo: '', hstNo: '', sourceOfGoods: '', contactName: '', contactEmail: '',
  contactPhone: '', address: '', city: '', postal: '', acceptsTerms: false
};
const SOURCES = ['Liquidation / overstock', 'Dealer or retailer overstock', 'Trade-ins and customer returns', 'Refurbishing used units', 'Manufacturer / distributor', 'Other'];

export default function VendorApplyForm() {
  const [f, setF] = useState(BLANK);
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/marketplace/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, [HONEYPOT_FIELD]: hp }) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not send your application.'); return; }
      setDone(true);
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  if (done) return <div><h2 style={{ marginTop: 0 }}>Thank you</h2><p>We have your application and will be in touch by email. We review each one by hand, usually within two business days.</p></div>;

  return (
    <form onSubmit={submit}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Apply</h2>
      {err && <div className="error-box">{err}</div>}
      <HoneypotField value={hp} onChange={(e) => setHp(e.target.value)} />
      <div className="field"><label>Legal business name</label><input value={f.legalName} onChange={set('legalName')} required /></div>
      <div className="field"><label>Trading name (if different)</label><input value={f.tradeName} onChange={set('tradeName')} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0 16px' }}>
        <div className="field"><label>Business number (optional)</label><input value={f.businessNo} onChange={set('businessNo')} /></div>
        <div className="field"><label>HST number (leave blank if not registered)</label><input value={f.hstNo} onChange={set('hstNo')} /></div>
        <div className="field"><label>Your name</label><input value={f.contactName} onChange={set('contactName')} required /></div>
        <div className="field"><label>Business email</label><input type="email" value={f.contactEmail} onChange={set('contactEmail')} required /></div>
        <div className="field"><label>Phone</label><input value={f.contactPhone} onChange={set('contactPhone')} /></div>
        <div className="field"><label>Where does your stock come from?</label>
          <select value={f.sourceOfGoods} onChange={set('sourceOfGoods')} required><option value="">Choose…</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Warehouse / pickup address</label><input value={f.address} onChange={set('address')} /></div>
        <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
        <div className="field"><label>Postal code</label><input value={f.postal} onChange={set('postal')} /></div>
      </div>
      <div className="field"><label><input type="checkbox" checked={f.acceptsTerms} onChange={set('acceptsTerms')} required />{' '}
        I understand every unit needs a one-year warranty from me, pre-owned units are sold as Refurbished, and accounts with three strikes are restricted.</label></div>
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button>
    </form>
  );
}
