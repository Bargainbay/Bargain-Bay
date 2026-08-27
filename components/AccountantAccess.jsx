'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Who can see the books. Granted by email, revoked in one click, no deploy.
//
// Revoking keeps the row rather than deleting it: who had access to the
// financials, and between which dates, is exactly what somebody asks about
// later — and "we think we removed them" is not an answer.
export default function AccountantAccess({ initial = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState({ email: '', name: '', note: '' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function post(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/accountants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      setRows(d.accountants);
      router.refresh();
      return d;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(''); }
  }

  async function grant() {
    if (!form.email.trim()) { setErr('Enter their email address.'); return; }
    const d = await post({ action: 'grant', ...form }, 'grant');
    if (d) { setMsg(`${form.email.trim().toLowerCase()} can now see the books.`); setForm({ email: '', name: '', note: '' }); }
  }

  const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13 };
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '—');

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        They sign in at <b>/login</b> with this email — they&apos;ll need to create the account themselves at
        <b> /signup</b> first, same as any other user. Access covers the financial dashboard, the P&amp;L, the
        records pack and the expense ledger, including categorising and answering HST. It does <b>not</b> cover
        orders, inventory, pricing, payroll, or connecting and disconnecting the bank feeds.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="email" placeholder="accountant@firm.ca" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...inp, width: 220 }} />
        <input placeholder="Name (optional)" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inp, width: 150 }} />
        <input placeholder="Note — e.g. 2026 year-end" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...inp, flex: '1 1 160px' }} />
        <button className="dash-filter active" disabled={!!busy} onClick={grant}>
          {busy === 'grant' ? '…' : 'Grant access'}
        </button>
      </div>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="admin">
            <thead><tr><th>Email</th><th>Note</th><th>Granted</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td>
                    <b>{r.email}</b>
                    {r.name && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.name}</div>}
                  </td>
                  <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.note || '—'}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {when(r.grantedAt)}
                    {r.grantedBy && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>by {r.grantedBy}</div>}
                  </td>
                  <td>
                    {r.active
                      ? <span className="pill ok" style={{ fontSize: 11 }}>active</span>
                      : <span className="pill sold" style={{ fontSize: 11 }}>revoked {when(r.revokedAt)}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.active ? (
                      <button className="dash-filter" disabled={!!busy}
                        onClick={() => {
                          if (!window.confirm(`Revoke ${r.email}? They lose access to the books immediately.`)) return;
                          post({ action: 'revoke', email: r.email }, r.email);
                        }}>Revoke</button>
                    ) : (
                      <button className="dash-filter" disabled={!!busy}
                        onClick={() => post({ action: 'grant', email: r.email }, r.email)}>Re-grant</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
