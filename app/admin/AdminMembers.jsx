'use client';
import { useState } from 'react';

export default function AdminMembers({ initialMembers }) {
  const [members, setMembers] = useState(initialMembers || []);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');

  async function act(id, decision) {
    setBusy(id); setErr('');
    try {
      const r = await fetch('/api/admin/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, decision })
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Action failed'); return; }
      const d = await fetch('/api/admin/members').then((x) => x.json()).catch(() => ({}));
      if (d.members) setMembers(d.members);
    } catch { setErr('Network error'); } finally { setBusy(null); }
  }

  const pending = members.filter((m) => m.member_status === 'pending');
  const approved = members.filter((m) => m.member_status === 'approved');
  const dt = (s) => (s ? new Date(s).toLocaleDateString('en-CA') : '—');

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Member applications ({pending.length} pending)</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        Approving a business unlocks wholesale member pricing on their account — 55% of retail on regular items, 10% off on clearance.
      </p>
      {err && <div className="error-box">{err}</div>}
      {pending.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>No pending applications.</div>
      ) : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Business</th><th>Contact</th><th>Note</th><th>Requested</th><th></th></tr></thead>
          <tbody>{pending.map((m) => (
            <tr key={m.id}>
              <td><b>{m.business_name || '—'}</b></td>
              <td>{m.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.email}{m.phone ? ' · ' + m.phone : ''}</div></td>
              <td style={{ fontSize: 13, maxWidth: 240 }}>{m.member_note || '—'}</td>
              <td style={{ fontSize: 12.5 }}>{dt(m.member_requested_at)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn primary" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === m.id} onClick={() => act(m.id, 'approve')}>Approve</button>{' '}
                <button className="btn danger" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === m.id} onClick={() => act(m.id, 'reject')}>Reject</button>
              </td>
            </tr>))}
          </tbody>
        </table></div>
      )}

      <h3 style={{ color: 'var(--charcoal)', marginTop: 22, fontSize: 15 }}>Active members ({approved.length})</h3>
      {approved.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>No active members yet.</div>
      ) : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Business</th><th>Contact</th><th>Member since</th><th></th></tr></thead>
          <tbody>{approved.map((m) => (
            <tr key={m.id}>
              <td><b>{m.business_name || '—'}</b></td>
              <td>{m.name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.email}</div></td>
              <td style={{ fontSize: 12.5 }}>{dt(m.member_approved_at)}</td>
              <td><button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === m.id} onClick={() => act(m.id, 'revoke')}>Revoke</button></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
