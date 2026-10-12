'use client';
import { useEffect, useState } from 'react';

// Below-floor sales waiting for an admin. An admin approves or rejects here, and
// approving raises and sends the invoice on the spot. A rep sees only their own
// requests and what became of them. Renders nothing when there is nothing to show.
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const STATUS = { pending: ['waiting', '#a15c00'], approved: ['approved', '#1a7f37'], rejected: ['rejected', '#b3261e'], withdrawn: ['withdrawn', '#666'] };

export default function ApprovalRequests() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState({});

  const load = () => fetch('/api/admin/invoice-approvals').then((r) => r.json()).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);

  async function act(id, action) {
    if (action === 'approve' && !window.confirm('Approve this sale? The invoice is raised and emailed to the customer straight away, below the floor.')) return;
    setBusy(id); setErr('');
    try {
      const res = await fetch('/api/admin/invoice-approvals', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, note: notes[id] || '' })
      });
      const j = await res.json();
      if (!res.ok) setErr(j.error || 'Could not do that.');
    } catch { setErr('Network error — try again.'); }
    setBusy(0); load();
  }

  const reqs = d?.requests || [];
  if (!reqs.length) return null;
  const admin = !!d.admin;
  const waiting = reqs.filter((r) => r.status === 'pending').length;

  return (
    <div className="panel" id="approvals" style={{ marginTop: 18, borderLeft: waiting && admin ? '4px solid #a15c00' : undefined }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
        {admin ? 'Sales waiting for your approval' : 'Your approval requests'}{waiting ? ` (${waiting})` : ''}
      </h2>
      {err && <div className="error-box">{err}</div>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {reqs.map((r) => {
          const [label, color] = STATUS[r.status] || STATUS.pending;
          return (
            <li key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line, #eee)' }}>
              <div style={{ fontSize: 14 }}>
                <strong>{r.customer || 'Customer'}</strong> — {money(r.total)}
                {admin && <span className="hint" style={{ marginLeft: 8 }}>asked by {r.requestedName || r.requestedBy}</span>}
                <span className="hint" style={{ marginLeft: 8, fontSize: 12 }}>{when(r.requestedAt)}</span>
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color }}>{label}</span>
                {r.invoiceNumber && <span className="hint" style={{ marginLeft: 8 }}>→ {r.invoiceNumber}</span>}
              </div>
              {admin && r.status === 'pending' && (
                <>
                  <div style={{ fontSize: 13, color: '#9b1c1c', margin: '4px 0' }}>{r.reason}</div>
                  <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
                    {(r.payload?.items || []).filter((i) => i?.description).map((i, k) => (
                      <li key={k}>{i.description} — {money(i.amount)}</li>
                    ))}
                  </ul>
                  {r.repNote && <div className="hint" style={{ fontSize: 12.5 }}>Rep says: {r.repNote}</div>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                    <input placeholder="Note to the rep (optional)" value={notes[r.id] || ''} style={{ flex: '1 1 220px' }}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <button className="btn accent" disabled={busy === r.id} onClick={() => act(r.id, 'approve')}>Approve &amp; send invoice</button>
                    <button className="btn" disabled={busy === r.id} onClick={() => act(r.id, 'reject')}>Reject</button>
                  </div>
                </>
              )}
              {!admin && r.status === 'pending' && (
                <button className="btn" style={{ fontSize: 12, marginTop: 4 }} disabled={busy === r.id} onClick={() => act(r.id, 'withdraw')}>Withdraw</button>
              )}
              {r.status !== 'pending' && r.decisionNote && <div className="hint" style={{ fontSize: 12.5 }}>{r.decidedName}: {r.decisionNote}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
