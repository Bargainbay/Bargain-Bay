'use client';
import { useState } from 'react';

export default function MemberRequest() {
  const [biz, setBiz] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await fetch('/api/account/membership', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName: biz, note })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not submit your request.'); return; }
      setSent(true);
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  if (sent) return <p style={{ fontSize: 14.5 }}>Thanks — your member application is <b>under review</b>. We'll email you once it's approved.</p>;

  return (
    <form onSubmit={submit}>
      <p style={{ fontSize: 14.5, marginTop: 0 }}>
        Buying for a business? Property managers, stores, and resellers get <b>member (wholesale) pricing</b> once approved. Tell us about your business:
      </p>
      {err && <div className="error-box">{err}</div>}
      <input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="Business name" required
        style={{ display: 'block', width: '100%', maxWidth: 420, padding: '9px 11px', margin: '8px 0', border: '1px solid var(--line)', borderRadius: 8 }} />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What do you buy, and how often? (optional)" rows={3}
        style={{ display: 'block', width: '100%', maxWidth: 420, padding: '9px 11px', marginBottom: 8, border: '1px solid var(--line)', borderRadius: 8 }} />
      <button className="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Request member access'}</button>
    </form>
  );
}
