'use client';
import { useEffect, useState } from 'react';

// Shop clock-in. A day with a shop clock-in is an In-house Day; every other working day is a
// Mobile Day. On a Mobile Day only accounts the rep brought in earn commission, so this is the
// button that decides how the day is counted — which is why it says so.
const post = (action) => fetch('/api/sales/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const time = (d) => new Date(d).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });

export default function RepClock() {
  const [open, setOpen] = useState(undefined);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => fetch('/api/sales/clock').then((r) => r.json()).then((d) => setOpen(d.open || null)).catch(() => setOpen(null));
  useEffect(() => { load(); }, []);
  async function go(action) {
    setBusy(true); setErr('');
    const r = await post(action);
    setBusy(false);
    if (!r.ok) setErr(r.error || 'That did not work.');
    await load();
  }
  if (open === undefined) return null;
  return (
    <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <div>
        <b>{open ? `At the shop since ${time(open.started_at)}` : 'Not clocked in at the shop'}</b>
        <div className="hint" style={{ fontSize: 12.5 }}>
          {open ? 'Today counts as an In-house Day.' : 'Clock in when you start the day at the shop. Any other working day is a Mobile Day.'}
        </div>
        {err && <div role="alert" style={{ color: 'var(--red, #c33)', fontSize: 13 }}>{err}</div>}
      </div>
      <button className="btn accent" disabled={busy} onClick={() => go(open ? 'out' : 'in')}>{open ? 'Clock out' : 'Clock in at the shop'}</button>
    </div>
  );
}
