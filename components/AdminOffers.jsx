'use client';
import { useState } from 'react';
import { money } from '../lib/constants';

export default function AdminOffers({ initial }) {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState('');
  const [counter, setCounter] = useState({});

  async function load(s) {
    setStatus(s);
    const r = await fetch(`/api/admin/offers?status=${s}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    setRows(d.offers || []);
  }
  async function decide(id, decision, price) {
    setMsg('');
    const r = await fetch('/api/admin/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision, price }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || 'Could not save.'); return; }
    await load(status);
  }

  const [modes, setModes] = useState(null);
  const [sku, setSku] = useState('');
  async function loadModes() {
    const r = await fetch('/api/admin/offers?modes=1', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    setModes(d.modes || {});
  }
  async function setMode(k, mode) {
    setMsg('');
    const r = await fetch('/api/admin/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mode', sku: k, mode }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || 'Could not save.'); return; }
    setModes(d.modes); setSku('');
  }

  return (
    <div>
      <details className="panel" style={{ marginBottom: 12 }} onToggle={(e) => { if (e.currentTarget.open && !modes) loadModes(); }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Force a unit open or closed to offers</summary>
        <p className="hint">By default a unit is open when its price has room above the floor. Here you can force one open (the floor still applies) or closed.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" aria-label="SKU" />
          <button className="btn" disabled={!sku.trim()} onClick={() => setMode(sku, 'open')}>Force open</button>
          <button className="btn" disabled={!sku.trim()} onClick={() => setMode(sku, 'closed')}>Force closed</button>
          <button className="btn" disabled={!sku.trim()} onClick={() => setMode(sku, '')}>Back to automatic</button>
        </div>
        {modes && Object.keys(modes).length > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 14 }}>
          {Object.entries(modes).map(([k, m]) => <li key={k}>{k}: <b>{m}</b> <button className="btn" style={{ marginLeft: 6 }} onClick={() => setMode(k, '')}>Reset</button></li>)}
        </ul>}
      </details>
      <div className="mp-chips">
        {[['open', 'Waiting'], ['accepted', 'Accepted'], ['purchased', 'Bought'], ['declined', 'Declined'], ['all', 'All']].map(([k, l]) =>
          <button key={k} className="mp-chip" aria-pressed={status === k} onClick={() => load(k)}>{l}</button>)}
      </div>
      {msg && <div className="error-box">{msg}</div>}
      {rows.length === 0 && <div className="panel">Nothing here.</div>}
      {rows.map((o) => {
        const margin = o.cost == null ? null : o.amount - o.cost;
        const waiting = o.status === 'open' || o.status === 'countered';
        return (
          <div className="panel" key={o.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b>{o.title || o.sku} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({o.sku})</span></b>
              <span className="status-chip">{o.status}</span>
            </div>
            <div style={{ fontSize: 14, marginTop: 6 }}>
              {o.kind === 'public' ? <>{o.name} ({o.email}{o.phone ? `, ${o.phone}` : ''}) <span className="status-chip">{o.verified_at ? 'email confirmed' : 'email NOT confirmed'}</span> </> : <>{o.business_name || o.email} <span className="status-chip">reseller</span> </>}offered <b>{money(o.amount)}</b> · their price {money(o.list_price)}
              {o.cost != null && <> · cost {money(o.cost)} · margin at offer <b style={{ color: margin < 0 ? 'var(--warn)' : undefined }}>{money(margin)}</b></>}
              {o.agreed_price != null && <> · agreed {money(o.agreed_price)}</>}
            </div>
            {o.note && <div style={{ fontSize: 13.5, marginTop: 4, color: 'var(--muted)' }}>“{o.note}”</div>}
            {waiting && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn" onClick={() => decide(o.id, 'accept')} disabled={o.status === 'countered' || !o.verified_at}>Accept {money(o.amount)}</button>
                <input type="number" step="0.01" placeholder="Counter $" value={counter[o.id] || ''} style={{ width: 110 }}
                  onChange={(e) => setCounter({ ...counter, [o.id]: e.target.value })} aria-label="Counter price" />
                <button className="btn" onClick={() => decide(o.id, 'counter', counter[o.id])} disabled={!counter[o.id] || !o.verified_at}>Counter</button>
                <button className="btn" onClick={() => decide(o.id, 'decline')}>Decline</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
