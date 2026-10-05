'use client';
import { useState } from 'react';
import MarketingOptIn, { CONSENT_TEXT } from '../../components/MarketingOptIn';
import HoneypotField, { HONEYPOT_FIELD } from '../../components/HoneypotField';

export default function GiveawayForm() {
  const [f, setF] = useState({ name: '', email: '', phone: '', postal: '', eligible: false, marketingOptIn: false, [HONEYPOT_FIELD]: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/giveaway', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, marketingOptInText: f.marketingOptIn ? CONSENT_TEXT : '' })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not submit your entry.'); return; }
      setDone(d.entered ? 'in' : 'already');
    } catch { setErr('Network error. Please try again.'); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="panel" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>{done === 'in' ? 'You’re entered. Good luck!' : 'You’re already entered.'}</h2>
        <p style={{ fontSize: 14.5 }}>
          {done === 'in' ? 'We just emailed a confirmation. ' : 'There is one entry per person. '}
          Meanwhile, see <a href="/deals" style={{ textDecoration: 'underline' }}>this week’s deals</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="giveaway-form">
      {err && <div className="error-box">{err}</div>}
      <HoneypotField value={f[HONEYPOT_FIELD]} onChange={set(HONEYPOT_FIELD)} />
      <label>Full name<input value={f.name} onChange={set('name')} required autoComplete="name" /></label>
      <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
      <label>Phone (optional)<input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
      <label>Ontario postal code<input value={f.postal} onChange={set('postal')} required autoComplete="postal-code" placeholder="L1W 3T9" maxLength={7} /></label>
      <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontWeight: 400, fontSize: 13.5, lineHeight: 1.45 }}>
        <input type="checkbox" checked={f.eligible} onChange={(e) => setF((s) => ({ ...s, eligible: e.target.checked }))} style={{ marginTop: 2, width: 'auto' }} />
        <span>I am 18 or older, I live in Ontario, and I have read and agree to the <a href="#rules" style={{ textDecoration: 'underline' }}>contest rules</a>.</span>
      </label>
      <MarketingOptIn id="giveaway-opt-in" checked={f.marketingOptIn} onChange={(v) => setF((s) => ({ ...s, marketingOptIn: v }))} />
      <p className="hint" style={{ margin: 0 }}>The box above is optional and has no effect on your entry.</p>
      <button className="btn primary" disabled={busy}>{busy ? 'Entering…' : 'Enter the giveaway'}</button>
    </form>
  );
}
