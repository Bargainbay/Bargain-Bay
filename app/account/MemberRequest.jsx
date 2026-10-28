'use client';
import { useState } from 'react';
import AgreementScroll from '../../components/AgreementScroll';
import { MEMBER_TERMS, MEMBER_TERMS_VERSION } from '../../lib/member-terms';

// Ask for member access: the business, then the agreement. The Accept button stays dead until the agreement has been
// scrolled to the end (components/AgreementScroll.jsx); the version shown goes to the server and is recorded.
export default function MemberRequest() {
  const [biz, setBiz] = useState('');
  const [read, setRead] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!read) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/account/membership', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName: biz, acceptTerms: true, termsVersion: MEMBER_TERMS_VERSION })
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
        Buying for a business? Property managers, stores, and resellers get <b>member (wholesale) pricing</b> once approved. What is your business called?
      </p>
      {err && <div className="error-box">{err}</div>}
      <input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="Business name" required
        style={{ display: 'block', width: '100%', maxWidth: 420, padding: '9px 11px', margin: '8px 0', border: '1px solid var(--line)', borderRadius: 8 }} />
      <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>Member Agreement</h3>
      <div style={{ maxWidth: 560 }}>
        <AgreementScroll sections={MEMBER_TERMS} label="Member Agreement" read={read} onRead={() => setRead(true)} maxHeight={260} />
      </div>
      <button className="btn primary" disabled={busy || !read}>{busy ? 'Submitting…' : 'Accept and request member access'}</button>
    </form>
  );
}
