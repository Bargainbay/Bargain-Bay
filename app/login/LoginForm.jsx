'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/account';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed.'); return; }
      window.location.href = next;
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Login</h1>
        <p className="hint" style={{ marginBottom: 16 }}>Track your orders and check out faster.</p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>
          No account? <a href={`/signup?next=${encodeURIComponent(next)}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>Create one</a>.
        </p>
        <p className="hint">
          <a href="/forgot-password" style={{ textDecoration: 'underline' }}>Forgot your password?</a>
        </p>
      </div>
    </div>
  );
}
