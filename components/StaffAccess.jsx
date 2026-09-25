'use client';
import { useEffect, useState } from 'react';

// Who can reach the back office, and the record of who let them in.
//
// The environment lists are shown but not editable: they are the floor that
// guarantees the owner can always get in, and a screen that could remove the
// last admin is a screen that eventually will.
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');

export default function StaffAccess() {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('sales');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => fetch('/api/admin/staff').then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  async function act(fn) {
    setBusy(true); setErr('');
    try {
      const res = await fn();
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); return; }
      setEmail(''); setNote('');
      await load();
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  const grant = () => act(() => fetch('/api/admin/staff', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, note })
  }));

  const revoke = (g) => {
    if (!window.confirm(`Remove ${g.role} access for ${g.email}?`)) return;
    act(() => fetch(`/api/admin/staff?email=${encodeURIComponent(g.email)}&role=${g.role}`, { method: 'DELETE' }));
  };

  if (!data) return <div className="panel"><p className="hint" style={{ margin: 0 }}>Loading access…</p></div>;

  const live = (data.grants || []).filter((g) => !g.revoked_at);
  const past = (data.grants || []).filter((g) => g.revoked_at);

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Staff access</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Granting here takes effect within about thirty seconds, everywhere, with no deploy.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', margin: '14px 0' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="sa-email">Email</label>
          <input id="sa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@rssolutions.ca" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="sa-role">Role</label>
          <select id="sa-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="sales">Sales</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 180px' }}>
          <label htmlFor="sa-note">Note <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
          <input id="sa-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="started Monday" />
        </div>
        <button className="btn primary" disabled={busy || !email} onClick={grant}>Give access</button>
      </div>

      {err && <div className="error-box">{err}</div>}

      {live.length > 0 && (
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>Email</th><th>Role</th><th>Since</th><th>Given by</th><th /></tr></thead>
            <tbody>
              {live.map((g) => (
                <tr key={g.id}>
                  <td>{g.email}</td>
                  <td><span className="pill">{g.role}</span></td>
                  <td>{fmt(g.granted_at)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{g.granted_by || '—'}{g.note ? ` · ${g.note}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" disabled={busy} onClick={() => revoke(g)} style={{ fontSize: 12.5 }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Most admins are here, not in the table, and would otherwise be invisible. */}
      <p className="hint" style={{ marginTop: 14 }}>
        <b>Also admin, from the deploy settings:</b>{' '}
        {data.fromEnv.admin.length ? data.fromEnv.admin.join(', ') : 'nobody'}
        {data.fromEnv.sales.length > 0 && <><br /><b>Also sales:</b> {data.fromEnv.sales.join(', ')}</>}
        <br />
        These cannot be changed here on purpose — they are what guarantees somebody can
        always get in, including to fix this screen. Changing them means editing
        <code> ADMIN_EMAILS</code> / <code>SALES_EMAILS</code> in Vercel and redeploying.
      </p>

      {past.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13.5 }}>Removed ({past.length})</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="admin">
              <thead><tr><th>Email</th><th>Role</th><th>From</th><th>Until</th><th>Removed by</th></tr></thead>
              <tbody>
                {past.map((g) => (
                  <tr key={g.id} style={{ opacity: 0.7 }}>
                    <td>{g.email}</td><td>{g.role}</td>
                    <td>{fmt(g.granted_at)}</td><td>{fmt(g.revoked_at)}</td>
                    <td style={{ fontSize: 12.5 }}>{g.revoked_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
