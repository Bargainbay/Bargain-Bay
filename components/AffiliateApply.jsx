'use client';
import { useState } from 'react';
import HoneypotField from './HoneypotField';
import { AFFILIATE_DEFAULT_PCT, AFFILIATE_HOLD_DAYS } from '../lib/commission-rules';

export default function AffiliateApply({ defaultName }) {
  const [f, setF] = useState({ name: defaultName, phone: '', payoutEmail: '', audience: '', acceptTerms: false, website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/affiliate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not send your application.'); return; }
      window.location.reload();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ position: 'relative' }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Apply</h2>
      <HoneypotField value={f.website} onChange={set('website')} />
      <div className="field"><label htmlFor="af-name">Your name</label>
        <input id="af-name" required value={f.name} onChange={set('name')} autoComplete="name" /></div>
      <div className="field"><label htmlFor="af-phone">Phone (optional)</label>
        <input id="af-phone" value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
      <div className="field"><label htmlFor="af-pay">Email for e-transfers</label>
        <input id="af-pay" type="email" required value={f.payoutEmail} onChange={set('payoutEmail')} />
        <div className="hint">This is where we send your commission. You can change it later.</div></div>
      <div className="field"><label htmlFor="af-aud">How will you promote us?</label>
        <textarea id="af-aud" required rows={3} value={f.audience} onChange={set('audience')}
          placeholder="e.g. I run a Durham-region Facebook group of 4,000 landlords and post deals weekly." />
        <div className="hint">Your audience, platforms, or the people you work with.</div></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, margin: '10px 0' }}>
        <input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} style={{ marginTop: 3 }} />
        <span>I have read the rules below. I will disclose that I earn a commission, I won’t send unsolicited messages in Bargain Bay’s name, and I understand commission is {AFFILIATE_DEFAULT_PCT}% (or the rate in my approval) of delivered orders after the {AFFILIATE_HOLD_DAYS}-day return window.</span>
      </label>
      {err && <div className="error-box" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="btn btn-primary" disabled={busy || !f.acceptTerms}>{busy ? 'Sending…' : 'Send my application'}</button>
    </form>
  );
}
