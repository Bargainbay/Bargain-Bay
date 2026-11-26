'use client';
import { useEffect, useState } from 'react';

// The daily call list: who gets new leads each morning, and how many.
export default function LeadDailyPanel() {
  const [cfg, setCfg] = useState(null);
  const [reps, setReps] = useState('');
  const [pool, setPool] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const take = (d) => { if (d.config) { setCfg(d.config); setReps(d.config.reps.join(', ')); } if (d.pool != null) setPool(d.pool); };
  useEffect(() => { fetch('/api/admin/lead-daily').then((r) => r.json()).then(take).catch(() => {}); }, []);

  async function post(body) {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/lead-daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'That did not work.'); return; }
      take(d);
      if (body.action === 'save') setMsg('Saved.');
      else if (d.skipped) setMsg('The daily list is switched off.');
      else setMsg(`Handed out: ${Object.entries(d.assigned || {}).map(([e, n]) => `${e} ${n}`).join(', ')}. ${d.pool} left in the pool.`);
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  }

  if (!cfg) return null;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Daily call list</h2>
      <p className="hint" style={{ marginTop: 0 }}>Each morning every rep below gets new leads, due that day. {pool} uncalled leads are waiting in the pool.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> On</label>
        <label>Each rep, per day <input type="number" min="1" max="100" value={cfg.perRep} onChange={(e) => setCfg({ ...cfg, perRep: e.target.value })} style={{ width: 80 }} /></label>
        <input value={reps} onChange={(e) => setReps(e.target.value)} placeholder="Rep emails, separated by commas" aria-label="Rep emails" style={{ flex: '1 1 320px' }} />
        <button className="btn accent" disabled={busy} onClick={() => post({ action: 'save', config: { ...cfg, reps } })}>Save</button>
        <button className="btn" disabled={busy} onClick={() => post({ action: 'assign-now' })}>Hand out today&apos;s now</button>
      </div>
      {msg && <p role="status" style={{ fontSize: 14 }}>{msg}</p>}
    </div>
  );
}
