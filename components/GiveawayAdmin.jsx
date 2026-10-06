'use client';
import { useState } from 'react';

export default function GiveawayAdmin({ initial, title, drawDate }) {
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');

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
    <div className="panel" style={{ maxWidth: 1100 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ fontSize: 14.5 }}>
        <b>{o.total}</b> people · <b>{o.tickets}</b> entries in the pot · <b>{o.optIns}</b> subscribed · draw planned {drawDate}
      </p>
      {err && <div className="error-box">{err}</div>}

      {w && w.status === 'winner' && (
        <div style={{ border: '1px solid var(--charcoal)', borderRadius: 8, padding: 14, margin: '12px 0' }}>
          <b>Winner drawn: {w.name}</b>
          <div style={{ fontSize: 14, margin: '6px 0' }}>{w.email}{w.phone ? ` · ${w.phone}` : ''} · {w.postal_prefix} · {w.tickets} {w.tickets === 1 ? 'entry' : 'entries'}</div>
          <div style={{ fontSize: 14, margin: '6px 0' }}>
            Instagram: {w.instagram_handle ? <a href={`https://instagram.com/${w.instagram_handle}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>@{w.instagram_handle}</a> : 'not given'}. Check they follow us before you award the prize.
          </div>
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
      <h3 style={{ fontSize: 14, margin: '22px 0 6px' }}>Entrants ({o.entries.length})</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 8px', flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, Instagram" style={{ maxWidth: 320 }} />
        <a className="btn" href="/api/admin/giveaway?format=csv">Download CSV</a>
      </div>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr><th>Entered</th><th>Name</th><th>Email</th><th>Phone</th><th>Postal</th><th>Entries</th><th>Account</th><th>Email list</th><th>Instagram</th><th>Video</th><th>Status</th></tr>
          </thead>
          <tbody>
            {o.entries.filter((e) => {
              const t = q.trim().toLowerCase();
              return !t || [e.name, e.email, e.phone, e.instagram_handle].some((v) => String(v || '').toLowerCase().includes(t));
            }).map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{e.created_at ? new Date(e.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</td>
                <td>{e.name}</td>
                <td>{e.email}</td>
                <td>{e.phone || ''}</td>
                <td>{e.postal_prefix}</td>
                <td><b>{e.tickets}</b></td>
                <td>{e.has_account ? 'yes' : <span title="Entered before an account was required">no</span>}</td>
                <td>{e.newsletter ? 'yes' : <span title="Not subscribed, or unsubscribed since">no</span>}</td>
                <td>{e.instagram_handle ? <a href={`https://instagram.com/${e.instagram_handle}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>@{e.instagram_handle}</a> : ''}</td>
                <td>{e.video_status || ''}</td>
                <td>{e.status}</td>
              </tr>
            ))}
            {o.entries.length === 0 && <tr><td colSpan={11} className="hint">No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, margin: '22px 0 6px' }}>Thankful videos ({o.videos.length})</h3>
      {o.videos.length === 0 && <p className="hint">None yet.</p>}
      {o.videos.map((v) => (
        <div key={v.id} style={{ borderTop: '1px solid var(--line-soft)', padding: '12px 0' }}>
          <div style={{ fontSize: 14 }}><b>{v.name}</b> · {v.email} · <i>{v.video_status}</i></div>
          <video controls preload="metadata" src={`/api/admin/giveaway/video?id=${v.id}`} style={{ width: '100%', maxWidth: 420, margin: '8px 0', borderRadius: 8, background: '#000' }} />
          <div className="btn-row">
            <button className="btn primary" disabled={busy || v.video_status === 'approved'} onClick={() => call({ action: 'review_video', id: v.id, outcome: 'approved' })}>Approve (+3 entries)</button>
            <button className="btn" disabled={busy || v.video_status === 'rejected'} onClick={() => call({ action: 'review_video', id: v.id, outcome: 'rejected' })}>Reject</button>
          </div>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 14 }}>
        Before the draw: take the prize unit off sale (or set one of the two identical freezers aside) and make sure entries have closed and every pending video has been reviewed.
      </p>
    </div>
  );
}
