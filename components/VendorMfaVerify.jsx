'use client';
import { useState } from 'react';

import { safeNext } from '../lib/vendor-next';

export default function VendorMfaVerify({ next, stepUp }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/vendor/mfa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', code })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || 'That code did not work.'); setBusy(false); return; }
      window.location.href = safeNext(next);
    } catch {
      setErr('Could not reach the server. Try again.'); setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel" style={{ maxWidth: 420 }}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>{stepUp ? 'Confirm it is you' : 'Two-factor sign-in'}</h1>
      <p style={{ fontSize: 14 }}>
        {recovery
          ? 'Enter one of your recovery codes. Each works once.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <input
        autoFocus autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'}
        value={code} onChange={(e) => setCode(e.target.value)}
        placeholder={recovery ? 'XXXXX-XXXXX' : '123456'} aria-label="Code" style={{ width: '100%', fontSize: 18, letterSpacing: 2 }}
      />
      {err && <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 14 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy || !code.trim()}>Verify</button>
        <button type="button" className="btn" onClick={() => { setRecovery(!recovery); setCode(''); setErr(''); }}>
          {recovery ? 'Use my authenticator app' : 'Use a recovery code'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>
        Lost your phone and your recovery codes? Contact marketplace support; we will reset it after checking who you are.
      </p>
    </form>
  );
}
