'use client';
import { useEffect, useState } from 'react';

// What the Voice Manager sees, what it has done, and a button to make it ring now.
// The list is the SAME scan the phone call reads (lib/manager-issues.js), so the
// page and the call cannot disagree.
const SEV = { high: ['Urgent', '#b3261e', '#fdecea'], medium: ['Worth your time', '#8a5a00', '#fff4d6'], low: ['Small', '#41505e', '#eef2f6'] };

export default function VoiceManager() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    setErr('');
    try {
      const r = await fetch('/api/admin/manager-call', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load.');
      setData(j);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function post(body) {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await fetch('/api/admin/manager-call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.reason || j.error || 'Failed.');
      return j;
    } catch (e) { setErr(e.message); return null; }
    finally { setBusy(false); }
  }

  async function callNow() {
    if (!confirm('Ring the owner now?')) return;
    const j = await post({ action: 'call' });
    if (j?.ok) setMsg(`Ringing now — about ${j.issues} thing${j.issues === 1 ? '' : 's'} to talk about.`);
    load();
  }

  async function closeStale() {
    const p = await post({ action: 'plan_stale' });
    if (!p) return;
    const left = p.skipped.length;
    if (!confirm(`Close ${p.total - left} old stops?\n${p.done} marked done (signature, photos or clock-in)\n${p.cancel} cancelled (no trace they happened)\n${left} left alone (money reported or owing)`)) return;
    const r = await post({ action: 'close_stale' });
    if (r) setMsg(`${r.done} marked done, ${r.cancelled} cancelled, ${r.skipped.length} left for you${r.failed.length ? `, ${r.failed.length} failed` : ''}.`);
    load();
  }
  async function runBackup() {
    const r = await post({ action: 'backup_now' });
    if (r) setMsg(r.ok ? 'The backup ran fine.' : `The backup failed: ${r.reason}`);
  }

  if (!data) return <div className="panel">{err ? <div className="error-box">{err}</div> : 'Scanning the business…'}</div>;

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Voice Manager</h1>
      <p className="hint">
        Scans the website, the stock, the scheduled jobs and dispatch. It rings you (number ending {data.ringsLast4}) when something is
        worth a call, between 8am and 8pm Toronto time, and fixes the safe things you tell it to. Anything that moves money stays with you.
      </p>
      {!data.configured && <div className="error-box">Calling is not set up: Twilio and the Anthropic key are missing on this deployment.</div>}
      {err && <div className="error-box">{err}</div>}
      {msg && <p style={{ color: '#1e6b34' }}>{msg}</p>}
      <p><button className="btn primary" disabled={busy || !data.configured} onClick={callNow}>Call me now</button>{' '}
        <button className="btn" disabled={busy} onClick={load}>Re-scan</button></p>

      <h2>Needs you ({data.issues.length})</h2>
      {!data.issues.length && <p>Nothing needs you right now.</p>}
      {data.issues.map((i) => {
        const [label, fg, bg] = SEV[i.severity] || SEV.low;
        return (
          <div key={i.key} style={{ borderTop: '1px solid #e4e7ea', padding: '10px 0' }}>
            <span style={{ background: bg, color: fg, borderRadius: 10, padding: '2px 8px', fontSize: 12, marginRight: 8 }}>{label}</span>
            <b>{i.title}</b>
            {i.detail && i.detail !== i.title && <div className="hint" style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{i.detail}</div>}
            <div style={{ marginTop: 6 }}>
              {i.key === 'dispatch-loose-ends' && <button className="btn primary" disabled={busy} onClick={closeStale}>Close them</button>}{' '}
              {i.key.startsWith('health-backup-offsite') && <button className="btn primary" disabled={busy} onClick={runBackup}>Run backup now</button>}{' '}
              {i.link && <a className="btn" href={i.link}>Open</a>}{' '}
              <button className="btn" disabled={busy} onClick={async () => { await post({ action: 'snooze', key: i.key, days: 3 }); load(); }}>Snooze 3 days</button>
            </div>
          </div>
        );
      })}

      {data.hidden.length > 0 && (<>
        <h2>Snoozed ({data.hidden.length})</h2>
        {data.hidden.map((i) => (
          <div key={i.key} style={{ padding: '6px 0' }}>{i.title} <span className="hint">until {new Date(data.snoozes[i.key]).toLocaleDateString()}</span>{' '}
            <button className="btn" disabled={busy} onClick={async () => { await post({ action: 'unsnooze', key: i.key }); load(); }}>Bring back</button></div>
        ))}
      </>)}

      <h2>Notes for the manager</h2>
      {data.notes.map((n) => (
        <div key={n.id} style={{ padding: '4px 0' }}>{n.body}{' '}
          <button className="btn" disabled={busy} onClick={async () => { await post({ action: 'note_done', id: n.id }); load(); }}>Done</button></div>
      ))}
      <p><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Something to look into…" style={{ width: '60%' }} />{' '}
        <button className="btn" disabled={busy || !note.trim()} onClick={async () => { if (await post({ action: 'add_note', text: note })) { setNote(''); load(); } }}>Add note</button></p>

      <h2>Recent calls</h2>
      <div className="table-wrap"><table className="admin"><thead><tr><th>When</th><th>How</th><th>Result</th><th>What it did</th></tr></thead><tbody>
        {data.calls.map((c) => (
          <tr key={c.id}><td>{new Date(c.started_at).toLocaleString()}</td><td>{c.trigger === 'cron' ? 'Scheduled' : 'You asked'}</td>
            <td>{c.status}</td>
            <td>{(c.actions || []).map((a) => a.tool === 'set_photo_from_model' ? `photo ${a.model}` : a.tool).join(', ') || '—'}</td></tr>
        ))}
        {!data.calls.length && <tr><td colSpan="4" className="hint">No calls yet.</td></tr>}
      </tbody></table></div>
    </div>
  );
}
