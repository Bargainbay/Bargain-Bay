'use client';
import { useState } from 'react';

// Everyone who can sign in to this partner's portal. Anyone on the team can add or remove a login.
export default function PartnerTeam({ team, me }) {
  const [list, setList] = useState(team);
  const [f, setF] = useState({ email: '', name: '' });
  const [msg, setMsg] = useState('');
  const call = (body) => fetch('/api/partner/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
  async function add(e) {
    e.preventDefault(); setMsg('');
    const r = await call({ action: 'add', ...f });
    if (!r.ok) { setMsg(r.error || 'Could not add.'); return; }
    setList((l) => [...l, { email: f.email.trim().toLowerCase(), name: f.name }]);
    setMsg(r.accountCreated ? (r.emailed ? 'Added. They have been emailed a link to choose a password.' : `Added. Send them this link to choose a password: ${r.link}`) : 'Added. They can sign in with their existing account.');
    setF({ email: '', name: '' });
  }
  async function remove(email) {
    if (!confirm(`Remove ${email}? They will no longer be able to open this portal.`)) return;
    const r = await call({ action: 'remove', email });
    if (r.ok) setList((l) => l.filter((x) => x.email !== email)); else setMsg(r.error || 'Could not remove.');
  }
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Your team</div>
      <p className="hint" style={{ marginTop: 0 }}>Everyone here signs in with their own email and sees the same clients, orders and commission.</p>
      {list.map((m) => (
        <div key={m.email} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
          <span style={{ flex: 1 }}>{m.name ? `${m.name} · ` : ''}{m.email}{m.primary ? ' (main login)' : ''}</span>
          {!m.primary && m.email.toLowerCase() !== String(me).toLowerCase() && <button className="btn" onClick={() => remove(m.email)}>Remove</button>}
        </div>))}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <button className="btn btn-primary" type="submit">Add a login</button>
      </form>
      {msg && <p className="hint" style={{ marginBottom: 0, wordBreak: 'break-all' }}>{msg}</p>}
    </div>
  );
}
