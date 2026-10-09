'use client';
import { useEffect, useState } from 'react';
import ClaimPhotos from './ClaimPhotos';

const OPEN = ['open', 'responded', 'awaiting_refund'];
const LABEL = { open: 'Needs your answer', responded: 'You have answered', awaiting_refund: 'Refund agreed — we are paying the customer', resolved: 'Resolved', closed: 'Closed' };

function Clock({ label, deadline, done, now }) {
  if (done) return <div style={{ fontSize: 13 }}>{label}: <span className="pill ok">done</span></div>;
  const left = (new Date(deadline) - now) / 3600000;
  const text = left < 0 ? `OVERDUE by ${Math.abs(left).toFixed(1)} h` : left < 48 ? `${Math.floor(left)} h ${Math.round((left % 1) * 60)} m left` : `${Math.floor(left / 24)} days left`;
  return <div style={{ fontSize: 13 }}>{label}: <span className={`pill ${left < 6 ? 'warn' : 'ok'}`} style={left < 0 ? { background: 'var(--dangerbg)', color: 'var(--danger)' } : undefined}>{text}</span></div>;
}

export default function VendorClaims({ initial, serverNow, rules }) {
  const [claims, setClaims] = useState(initial);
  const skew = new Date(serverNow) - Date.now();
  const [now, setNow] = useState(() => new Date(Date.now() + skew));
  useEffect(() => { const t = setInterval(() => setNow(new Date(Date.now() + skew)), 30000); return () => clearInterval(t); }, [skew]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({});
  const f = (id, k) => form[id]?.[k] || '';
  const setF = (id, k, v) => setForm((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));

  async function refresh() { const d = await (await fetch('/api/vendor/claims')).json(); if (d.claims) setClaims(d.claims); }
  async function act(body, ok) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/vendor/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); await refresh(); return; }
      setMsg(ok); await refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  const open = claims.filter((c) => OPEN.includes(c.status));
  const past = claims.filter((c) => !OPEN.includes(c.status));
  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="panel" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>{msg}</div>}
      <div className="panel" style={{ fontSize: 14 }}>
        Every unit carries your warranty. When a customer makes a claim, we open it here. You have <b>{rules.respondHours} hours to respond</b> and <b>{rules.resolveDays} days to resolve it</b>
        (repair it, replace it, or agree that we refund the customer). Missing a deadline is a strike, and we will fix it ourselves and charge you — your warranty reserve first, then your balance.
      </div>
      <h2 style={{ fontSize: 17 }}>Open claims ({open.length})</h2>
      {open.length === 0 && <div className="panel">No open claims.</div>}
      {open.map((c) => (
        <div key={c.id} className="panel">
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong>{c.orderNumber}</strong> <span className="pill">{LABEL[c.status]}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{c.title || c.sku} ({c.sku})</span>
          </div>
          <p style={{ fontSize: 14, margin: '8px 0' }}>{c.description}</p>
          <Clock label={`Respond within ${rules.respondHours} h`} deadline={c.respondBy} done={c.vendorRespondedAt} now={now} />
          <Clock label={`Resolve within ${rules.resolveDays} days`} deadline={c.resolveBy} done={c.vendorDoneAt} now={now} />
          <ClaimPhotos claim={c} base="/api/vendor/claims/photos" canAdd onDone={refresh} />
          {c.notes.length > 0 && <ul style={{ fontSize: 13, paddingLeft: 18 }}>{c.notes.map((n, i) => <li key={i}>{n.side === 'vendor' ? 'You' : 'Bargain Bay'}: {n.note}</li>)}</ul>}
          {!c.vendorDoneAt && (
            <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 560 }}>
              {!c.vendorRespondedAt && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input placeholder="What will you do, and when?" value={f(c.id, 'reply')} onChange={(e) => setF(c.id, 'reply', e.target.value)} style={{ width: 300 }} />
                  <button className="btn primary" disabled={busy || f(c.id, 'reply').length < 5} onClick={() => act({ action: 'respond', id: c.id, note: f(c.id, 'reply') }, 'Response sent.')}>Respond</button>
                </div>)}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={f(c.id, 'res')} onChange={(e) => setF(c.id, 'res', e.target.value)} style={{ width: 'auto' }}>
                  <option value="">Resolved by…</option>{Object.entries(rules.resolutions).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                <input placeholder="What was done" value={f(c.id, 'done')} onChange={(e) => setF(c.id, 'done', e.target.value)} style={{ width: 240 }} />
                <button className="btn" disabled={busy || !f(c.id, 'res') || f(c.id, 'done').length < 5}
                  onClick={() => act({ action: 'resolve', id: c.id, resolution: f(c.id, 'res'), note: f(c.id, 'done') },
                    f(c.id, 'res') === 'refund' ? 'Noted — we will refund the customer and the cost is charged to you.' : 'Marked resolved.')}>Mark resolved</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>Choosing Refund means we pay the customer and take it from your warranty reserve, then your balance.</p>
            </div>)}
        </div>
      ))}
      <h2 style={{ fontSize: 17 }}>Past claims</h2>
      <div className="panel"><div className="table-wrap"><table className="admin"><thead><tr><th>Order</th><th>Unit</th><th>Status</th><th>Outcome</th></tr></thead><tbody>
        {past.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>None yet.</td></tr>}
        {past.map((c) => <tr key={c.id}><td>{c.orderNumber}</td><td>{c.sku}</td><td>{LABEL[c.status]}</td><td>{c.resolution || c.closedReason || ''}</td></tr>)}
      </tbody></table></div></div>
    </div>
  );
}
