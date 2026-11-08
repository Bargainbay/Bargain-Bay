'use client';
import { useState } from 'react';

// Hold a unit for a customer (up to 48 hours) and let go of it. A held unit disappears
// from the public store and from checkout until the hold ends or is released.
const post = (body) => fetch('/api/sales/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

export function HoldButton({ sku }) {
  const [state, setState] = useState('idle');
  const [msg, setMsg] = useState('');
  async function hold() {
    setState('busy'); setMsg('');
    const r = await post({ action: 'hold', sku, hours: 48 });
    if (r.ok) { setState('done'); setMsg('Held 48h'); setTimeout(() => window.location.reload(), 600); }
    else { setState('idle'); setMsg(r.error || 'Could not hold.'); }
  }
  return (
    <span>
      <button type="button" className="btn" style={{ fontSize: 12.5 }} disabled={state !== 'idle'} onClick={hold}>Hold 48h</button>
      {msg && <span className="hint" role="status" style={{ marginLeft: 6 }}>{msg}</span>}
    </span>
  );
}

export function MyHolds({ holds, isAdmin }) {
  const [gone, setGone] = useState([]);
  const shown = holds.filter((h) => !gone.includes(h.sku));
  if (!shown.length) return null;
  const left = (iso) => {
    const m = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
  };
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>{isAdmin ? 'Rep holds' : 'Your holds'}</h2>
      {shown.map((h) => (
        <div key={h.sku} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14 }}>
          <b>{h.make} {h.model}</b><span className="hint">{h.sku} · {left(h.expires_at)}{isAdmin ? ` · ${h.held_by}` : ''}</span>
          <button className="btn" style={{ fontSize: 12.5, marginLeft: 'auto' }}
            onClick={async () => { const r = await post({ action: 'release', sku: h.sku }); if (r.ok) setGone((g) => [...g, h.sku]); }}>Release</button>
        </div>
      ))}
    </div>
  );
}
