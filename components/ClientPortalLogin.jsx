'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// The one thing a client sees before the password is entered: who we are, and a
// single box. Nothing about the client's deliveries is on this page.
export default function ClientPortalLogin({ clientId, token, clientName }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/client/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: clientId, t: token, password: pw })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not sign in.'); return; }
      router.refresh();
    } catch { setErr('Network error — please try again.'); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={go} className="cp-panel cp-form" style={{ maxWidth: 420, margin: '8vh auto 0' }}>
      <h2 style={{ marginTop: 0 }}>{clientName ? `${clientName} — deliveries` : 'Your deliveries'}</h2>
      <p className="cp-sub" style={{ marginTop: 0 }}>Enter the password dispatch gave you to see your deliveries and invoices.</p>
      {err && <div className="error-box">{err}</div>}
      <label>Password
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required autoComplete="current-password" />
      </label>
      <button className="btn primary" style={{ marginTop: 12 }} disabled={busy}>{busy ? 'Checking…' : 'Open my deliveries'}</button>
    </form>
  );
}
