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

  return (
    <div>
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
              {o.business_name || o.email} offered <b>{money(o.amount)}</b> · their price {money(o.list_price)}
              {o.cost != null && <> · cost {money(o.cost)} · margin at offer <b style={{ color: margin < 0 ? 'var(--warn)' : undefined }}>{money(margin)}</b></>}
              {o.agreed_price != null && <> · agreed {money(o.agreed_price)}</>}
            </div>
            {o.note && <div style={{ fontSize: 13.5, marginTop: 4, color: 'var(--muted)' }}>“{o.note}”</div>}
            {waiting && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn" onClick={() => decide(o.id, 'accept')} disabled={o.status === 'countered'}>Accept {money(o.amount)}</button>
                <input type="number" step="0.01" placeholder="Counter $" value={counter[o.id] || ''} style={{ width: 110 }}
                  onChange={(e) => setCounter({ ...counter, [o.id]: e.target.value })} aria-label="Counter price" />
                <button className="btn" onClick={() => decide(o.id, 'counter', counter[o.id])} disabled={!counter[o.id]}>Counter</button>
                <button className="btn" onClick={() => decide(o.id, 'decline')}>Decline</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
