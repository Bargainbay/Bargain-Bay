'use client';
import { useEffect, useRef, useState } from 'react';

// Make an account that already exists a reseller from the back end -- for the person who signed up and never finished
// the application form. Search finds them, a business name is typed once, and one button approves them (they get the
// "you're approved" email). Nobody is asked to apply again.
export default function AddReseller({ initialAccounts = [] }) {
  const [q, setQ] = useState('');
  const [accounts, setAccounts] = useState(initialAccounts);
  const [biz, setBiz] = useState({});      // userId -> business name typed
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => {
      fetch('/api/admin/members?unapplied=1&q=' + encodeURIComponent(q), { cache: 'no-store' })
        .then((r) => r.json()).then((d) => { if (d.accounts) setAccounts(d.accounts); else setErr(d.error || 'Search failed'); })
        .catch(() => setErr('Network error'));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function add(a) {
    const name = (biz[a.id] ?? a.business_name ?? '').trim();
    if (!name) { setErr('Type the business name first.'); return; }
    if (!window.confirm(`Make ${a.email} a reseller (${name})? They will be approved now and emailed.`)) return;
    setBusy(a.id); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/members', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: a.id, decision: 'add', businessName: name }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not add them.'); return; }
      setMsg(`${a.email} is now a reseller. Reloading the list…`);
      setTimeout(() => window.location.reload(), 900);
    } catch { setErr('Network error'); } finally { setBusy(null); }
  }

  const dt = (s) => (s ? new Date(s).toLocaleDateString('en-CA') : '—');
  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Add a reseller without an application</h2>
      <p className="hint" style={{ marginBottom: 10 }}>
        Accounts that exist but have not applied or been answered, newest first. Search by email, name or phone, type the
        business name, and approve them here — nobody has to apply again.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts: email, name, phone…" aria-label="Search accounts"
        style={{ display: 'block', width: '100%', maxWidth: 420, padding: '9px 11px', margin: '0 0 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="panel" style={{ fontSize: 14, marginBottom: 10 }}>{msg}</div>}
      {accounts.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>No matching accounts.</div>
      ) : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Account</th><th>Created</th><th>Business name</th><th></th></tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a.id}>
              <td><b>{a.name || '—'}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.email}{a.phone ? ' · ' + a.phone : ''}</div></td>
              <td style={{ fontSize: 12.5 }}>{dt(a.created_at)}</td>
              <td><input value={biz[a.id] ?? a.business_name ?? ''} onChange={(e) => setBiz({ ...biz, [a.id]: e.target.value })}
                placeholder="Business name" style={{ padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 6, width: '100%', maxWidth: 260 }} /></td>
              <td><button className="btn primary" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === a.id} onClick={() => add(a)}>
                {busy === a.id ? 'Adding…' : 'Make reseller'}</button></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
