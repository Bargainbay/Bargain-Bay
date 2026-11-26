'use client';
// The "Subscribe to text deals" box. Pressing the button, with the wording right under it, is the yes.
import { useState } from 'react';
import { SMS_CONSENT_TEXT } from '../lib/consent-text';
import HoneypotField, { HONEYPOT_FIELD } from './HoneypotField';

export default function SmsSubscribe({ where = 'website', defaultPhone = '', variant = 'panel' }) {
  const [phone, setPhone] = useState(defaultPhone || '');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/sms-subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, where, agree: true, [HONEYPOT_FIELD]: trap })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not sign you up.'); return; }
      setDone(true);
    } catch { setErr('Network error. Please try again.'); } finally { setBusy(false); }
  }

  return (
    <div className={`sms-sub sms-sub-${variant} noprint`}>
      <strong>Get Bargain Bay deals by text</strong>
      <p className="sms-sub-lead">One of each unit. Text subscribers hear about the markdowns.</p>
      {done ? (
        <p role="status" className="sms-sub-done">✓ Thanks, you&apos;re signed up. If you replied STOP before, text START to the number we text you from.</p>
      ) : (
        <form onSubmit={submit}>
          <HoneypotField value={trap} onChange={(e) => setTrap(e.target.value)} />
          <div className="sms-sub-row">
            <input type="tel" required autoComplete="tel" inputMode="tel" aria-label="Mobile number" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="btn accent" disabled={busy}>{busy ? 'Signing up…' : 'Subscribe to text deals'}</button>
          </div>
          {err && <p role="alert" className="sms-sub-err">{err}</p>}
          <p className="sms-sub-fine">By pressing Subscribe you agree: “{SMS_CONSENT_TEXT}”</p>
        </form>
      )}
    </div>
  );
}
