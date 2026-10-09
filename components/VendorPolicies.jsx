'use client';
import { useState } from 'react';

// The policies a seller has to accept, and the button that accepts them. The versions on the page travel
// with the click, so a policy that changed in the meantime is refused rather than silently accepted.
export default function VendorPolicies({ docs, isOwner, accepted, pending }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [read, setRead] = useState(false);
  const acceptedKey = new Set(accepted.map((a) => `${a.policy}@${a.version}`));
  const pendingKey = new Set(pending.map((p) => `${p.slug}@${p.version}`));

  async function accept() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/vendor/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepting: pending.map((p) => ({ policy: p.slug, version: p.version })) })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); return; }
      window.location.reload();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  return (
    <div>
      {pending.length > 0 ? (
        <div className="panel" style={{ background: 'var(--warnbg)' }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Please read and accept our policies</h2>
          <p style={{ fontSize: 14 }}>You can list and sell once the account owner has accepted them. Open each one below, then accept.</p>
          {isOwner ? (
            <>
              <label style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
                <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />{' '}
                I have read the policies marked <b>Required</b> below and I accept them on behalf of the business.
              </label>
              {err && <div className="error-box">{err}</div>}
              <button className="btn primary" disabled={busy || !read} onClick={accept}>Accept the policies</button>
            </>
          ) : <p style={{ fontSize: 14, marginBottom: 0 }}>Only the account owner can accept them. Ask them to sign in and do so.</p>}
        </div>
      ) : (
        <div className="panel" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>You have accepted the current version of every required policy.</div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Marketplace policies</h2>
        <div className="table-wrap"><table className="admin"><thead><tr><th>Policy</th><th>Version</th><th>Status</th></tr></thead><tbody>
          {docs.map((d) => {
            const key = `${d.slug}@${d.version}`;
            return (
              <tr key={d.slug}>
                <td><a href={`/marketplace/policies/${d.slug}`} target="_blank" rel="noreferrer"><b>{d.title}</b></a>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{d.summary}</div></td>
                <td>{d.version}</td>
                <td>
                  {d.status !== 'published' ? <span className="pill">Draft — not in force</span>
                    : !d.required ? <span className="pill">For information</span>
                    : acceptedKey.has(key) ? <span className="pill ok">Accepted</span>
                    : pendingKey.has(key) ? <span className="pill warn">Required — not accepted</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>We give you at least 14 days&rsquo; notice before a change that affects you, and ask you to accept the new version here.</p>
      </div>
    </div>
  );
}
