'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SignupForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/account';
  const [form, setForm] = useState({ email: '', name: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Signup failed.'); return; }
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
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Create account</h1>
        <p className="hint" style={{ marginBottom: 16 }}>Track orders, get pickup updates, and check out faster.</p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" required autoComplete="name" value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(for delivery coordination)</span></label>
            <input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
            <div className="hint">At least 8 characters.</div>
          </div>
          <button className="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>
          Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>Login</a>.
        </p>
      </div>
    </div>
  );
}
