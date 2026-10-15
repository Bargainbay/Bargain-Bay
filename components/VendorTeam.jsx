'use client';
import { useState } from 'react';

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const MFA = { enrolled: ['ok', 'MFA on'], required: ['warn', 'MFA needed'], off: ['', 'MFA off'] };

// The owner's team page. Every change needs a fresh second-factor code (the server insists —
// this just says so). Nothing here is a permission; the server checks the role on each call.
export default function VendorTeam({ initial, me, enrolled, roles }) {
  const [team, setTeam] = useState(initial);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('viewer');
  const [err, setErr] = useState('');
  const [hint, setHint] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(body, ok) {
    setBusy(true); setErr(''); setHint(null); setMsg('');
    try {
      const res = await fetch('/api/vendor/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'That did not work.'); setHint(j.mfa || null); setBusy(false); return; }
      const r = await fetch('/api/vendor/team');
      if (r.ok) setTeam((await r.json()).team);
      setMsg(ok);
    } catch { setErr('Could not reach the server.'); }
    setBusy(false);
  }

  const active = team.filter((t) => !t.revokedAt);
  const past = team.filter((t) => t.revokedAt);
  return (
    <div>
      <div className="panel">
        <h1 style={{ marginTop: 0, fontSize: 20 }}>Your team</h1>
        <p style={{ fontSize: 14 }}>
          People you add sign up (or sign in) with the email address you give here — no password is shared.
          Each has a role that decides what they can do.
          {!enrolled && <> <strong>You need to <a href="/vendor/security">set up two-factor sign-in</a> before you can change the team.</strong></>}
        </p>
        {err && (
          <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 14 }}>
            {err}{' '}
            {hint === 'stepup' && <a href="/vendor/mfa?next=/vendor/team&fresh=1">Enter a fresh code →</a>}
            {hint === 'enrol' && <a href="/vendor/security?next=/vendor/team">Set up two-factor →</a>}
            {hint === 'verify' && <a href="/vendor/mfa?next=/vendor/team">Enter your code →</a>}
          </p>
        )}
        {msg && <p style={{ fontSize: 14 }}>{msg}</p>}
        <div className="table-wrap"><table className="admin"><thead><tr><th>Person</th><th>Role</th><th>Two-factor</th><th>Added</th><th /></tr></thead><tbody>
          {active.map((t) => {
            const [tone, label] = MFA[t.mfa] || ['', t.mfa];
            return (
              <tr key={t.email}>
                <td>{t.name ? `${t.name} · ` : ''}{t.email}{t.email.toLowerCase() === String(me).toLowerCase() ? ' (you)' : ''}{!t.hasAccount ? <span className="pill warn" style={{ marginLeft: 6 }}>not signed up yet</span> : null}</td>
                <td>
                  <select value={t.role} disabled={busy} onChange={(e) => act({ action: 'role', email: t.email, role: e.target.value }, 'Role changed.')} style={{ width: 'auto' }}>
                    {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </td>
                <td><span className={`pill ${tone}`}>{label}</span></td>
                <td>{day(t.grantedAt)}</td>
                <td><button className="btn" disabled={busy} onClick={() => confirm(`Remove ${t.email}? They lose access immediately.`) && act({ action: 'remove', email: t.email }, 'Removed.')}>Remove</button></td>
              </tr>
            );
          })}
        </tbody></table></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Add someone</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: 260 }} />
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 180 }} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button className="btn" disabled={busy || !email} onClick={() => act({ action: 'invite', email, name, role }, 'Added. Ask them to sign up or sign in with that address.').then(() => setEmail(''))}>Add</button>
        </div>
        <ul style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18 }}>
          {roles.map((r) => <li key={r.key}><strong>{r.label}:</strong> {r.blurb}</li>)}
        </ul>
      </div>

      {past.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Removed</h2>
          <ul style={{ fontSize: 14, paddingLeft: 18 }}>{past.map((t) => <li key={t.email + t.revokedAt}>{t.email} — removed {day(t.revokedAt)} by {t.revokedBy || 'staff'}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
