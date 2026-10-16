'use client';
// Asks a money-role vendor user to say how their sign-in is protected by 2-step verification, and
// records the answer. It is a declaration: Google/Microsoft sign-in and phone text codes both count.
import { useState } from 'react';
import { TWO_STEP_METHODS } from '../lib/vendor-permissions';

export default function TwoStepPrompt() {
  const [method, setMethod] = useState('google');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/vendor/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'attest_two_step', method }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not save that.');
      setDone(true); window.location.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (done) return null;
  return (
    <div className="panel" style={{ flexBasis: '100%', margin: '8px 0 0', borderColor: 'var(--danger, #b00020)' }}>
      <strong>Turn on 2-step verification for the account you sign in with.</strong>{' '}
      Signing in with Google or Microsoft with 2-step on, or getting a text-message code on your phone, is enough — you do not need an authenticator app.
      You need to confirm it before you can change the bank account or the team.
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 'auto' }}>
          {Object.entries(TWO_STEP_METHODS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="btn primary" disabled={busy} onClick={save}>I have turned on 2-step verification</button>
        {err && <span style={{ color: 'var(--danger)' }}>{err}</span>}
      </div>
    </div>
  );
}
