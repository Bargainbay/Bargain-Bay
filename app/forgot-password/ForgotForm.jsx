'use client';
import { useState } from 'react';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!res.ok) { setError('Something went wrong — please try again.'); return; }
      setDone(true);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Reset your password</h1>
        {done ? (
          <div className="notice-box" style={{ lineHeight: 1.6 }}>
            If <b>{email}</b> has an account, a reset link is on its way — check your inbox (and spam).
            The link works for 1 hour.
          </div>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 16 }}>
              Enter the email on your account and we&apos;ll send you a link to choose a new password.
            </p>
            {error && <div className="error-box">{error}</div>}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="fp-email">Email</label>
                <input id="fp-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
            </form>
          </>
        )}
        <p className="hint" style={{ marginTop: 14 }}>
          Remembered it? <a href="/login" style={{ fontWeight: 700, color: 'var(--charcoal)' }}>Back to login</a>.
        </p>
      </div>
    </div>
  );
}
