'use client';
import { useState } from 'react';

export default function GiveawayAdmin({ initial, title, drawDate }) {
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  async function call(payload) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/giveaway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Failed.'); return; }
      const fresh = await fetch('/api/admin/giveaway').then((x) => x.json());
      setO(fresh); setNote('');
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  const w = o.winner;
  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ fontSize: 14.5 }}>
        <b>{o.total}</b> entries · <b>{o.optIns}</b> ticked the marketing box · draw planned {drawDate}
      </p>
      {err && <div className="error-box">{err}</div>}

      {w && w.status === 'winner' && (
        <div style={{ border: '1px solid var(--charcoal)', borderRadius: 8, padding: 14, margin: '12px 0' }}>
          <b>Winner drawn: {w.name}</b>
          <div style={{ fontSize: 14, margin: '6px 0' }}>{w.email}{w.phone ? ` · ${w.phone}` : ''} · {w.postal_prefix}</div>
          <p className="hint">Contact them, have them answer the skill-testing question unaided, then record the result. They have 72 hours.</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ marginBottom: 8 }} />
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => call({ action: 'resolve', id: w.id, outcome: 'claimed', note })}>Answered correctly: prize claimed</button>
            <button className="btn" disabled={busy} onClick={() => call({ action: 'resolve', id: w.id, outcome: 'forfeited', note })}>Forfeited / unreachable</button>
          </div>
        </div>
      )}
      {w && w.status === 'claimed' && <p style={{ fontSize: 14.5 }}><b>Prize claimed by {w.name}</b> ({w.email}).</p>}

      {(!w || w.status === 'forfeited') && (
        <button className="btn primary" disabled={busy || o.total === 0}
          onClick={() => { if (window.confirm('Draw a winner now? This picks one entry at random and cannot be undone.')) call({ action: 'draw' }); }}>
          {busy ? 'Drawing…' : 'Draw a winner'}
        </button>
      )}

      {o.history.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Draw history</h3>
          <table className="admin">
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {o.history.map((h) => <tr key={h.id}><td>{h.name}</td><td>{h.email}</td><td>{h.status}</td><td>{h.note || ''}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
      <p className="hint" style={{ marginTop: 14 }}>
        Before the draw: take the prize unit off sale (or set one of the two identical freezers aside) and make sure entries have closed.
      </p>
    </div>
  );
}
