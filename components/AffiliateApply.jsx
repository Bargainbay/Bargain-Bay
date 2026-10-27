'use client';
// The application, and the agreement it ends with (AgreementScroll: the Accept button is dead until the end is reached;
// the server is told which VERSION was shown, so what was accepted is on record).
import { useState } from 'react';
import HoneypotField from './HoneypotField';
import AgreementScroll from './AgreementScroll';
import { AFFILIATE_TERMS, AFFILIATE_TERMS_VERSION } from '../lib/affiliate-terms';

export default function AffiliateApply({ defaultName }) {
  const [f, setF] = useState({ name: defaultName, phone: '', payoutEmail: '', audience: '', website: '' });
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!read) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/affiliate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION })
      });
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

      <h3 style={{ margin: '16px 0 6px', color: 'var(--charcoal)' }}>Affiliate Agreement</h3>
      <AgreementScroll sections={AFFILIATE_TERMS} label="Affiliate Agreement" read={read} onRead={() => setRead(true)} />

      {err && <div className="error-box" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="btn btn-primary" disabled={busy || !read}>{busy ? 'Sending…' : 'Accept and send my application'}</button>
    </form>
  );
}
