'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not reset your password.'); return; }
      setDone(true);
      setTimeout(() => { window.location.href = '/account'; }, 1500);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Choose a new password</h1>
        <div className="error-box">This page needs the link from your reset email. <a href="/forgot-password" style={{ textDecoration: 'underline' }}>Request a new one</a>.</div>
      </div></div>
    );
  }

  return (
    <div className="narrow">
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Choose a new password</h1>
        {done ? (
          <div className="notice-box">✓ Password updated — you&apos;re signed in. Taking you to your account…</div>
        ) : (
          <>
            {error && <div className="error-box">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="rp-pass">New password (8+ characters)</label>
                <input id="rp-pass" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button className="btn primary block" disabled={busy || password.length < 8}>{busy ? 'Saving…' : 'Set new password'}</button>
            </form>
            <p className="hint" style={{ marginTop: 12 }}>For your security this signs you out on all other devices.</p>
          </>
        )}
      </div>
    </div>
  );
}
