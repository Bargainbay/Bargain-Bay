'use client';
import { useState } from 'react';
import { claimState } from '../lib/claim-state';
import ClaimPhotos from './ClaimPhotos';

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

// Staff view of warranty claims. Opening / noting / resolving / closing is the customer's sale (staff);
// recording the money we paid and charging the seller is admin only, and `costCents` is not even sent
// to a staff browser.
export default function MarketplaceClaims({ claims, orders, isAdmin, busy, now, rules, post, act }) {
  const delivered = orders.filter((o) => o.status === 'delivered');
  const [form, setForm] = useState({ vendorOrderId: '', description: '' });
  const [sel, setSel] = useState({});
  const s = (id, k) => sel[id]?.[k] ?? '';
  const set = (id, k, v) => setSel((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const call = (body, ok) => act(() => post('/api/admin/marketplace/claims', body), ok);
  return (
    <div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Open a warranty claim</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>The customer contacts us; we open the claim against the delivered order. The seller then has {rules.respondHours} hours to respond and {rules.resolveDays} days to resolve it. A missed deadline is one strike.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={form.vendorOrderId} onChange={(e) => setForm({ ...form, vendorOrderId: e.target.value })} style={{ width: 'auto' }}>
            <option value="">Delivered seller order…</option>
            {delivered.map((o) => <option key={o.id} value={o.id}>{o.orderNumber} — {o.vendor} ({day(o.deliveredAt)})</option>)}
          </select>
          <input placeholder="What is wrong?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: 360 }} />
          <button className="btn primary" disabled={busy || !form.vendorOrderId || form.description.trim().length < 10}
            onClick={() => call({ action: 'open', vendorOrderId: Number(form.vendorOrderId), description: form.description }, 'Claim opened and the seller told.')}>Open claim</button>
        </div>
      </div>

      {claims.length === 0 && <div className="panel" style={{ color: 'var(--muted)' }}>No warranty claims yet.</div>}
      {claims.map((c) => {
        const st = claimState(c, now);
        const open = ['open', 'responded', 'awaiting_refund'].includes(c.status);
        return (
          <div key={c.id} className="panel">
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong>{c.orderNumber}</strong> <span>{c.vendor}</span> <span style={{ color: 'var(--muted)', fontSize: 13 }}>{c.title || c.sku} ({c.sku})</span>
              <span className="pill" style={st.overdue ? { background: 'var(--dangerbg)', color: 'var(--danger)' } : undefined}>{st.label}</span>
              {c.struck && <span className="pill warn">strike issued</span>}
            </div>
            <p style={{ fontSize: 14, margin: '6px 0' }}>{c.description}</p>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Opened {day(c.openedAt)} by {c.openedBy} · respond by {day(c.respondBy)}{c.vendorRespondedAt ? ' (answered)' : ''} · resolve by {day(c.resolveBy)}{c.vendorDoneAt ? ' (seller done)' : ''}
              {c.resolution ? ` · ${c.resolution}` : ''}{c.closedReason ? ` · closed: ${c.closedReason}` : ''}
              {isAdmin && c.costCents != null ? ` · we paid $${(c.costCents / 100).toFixed(2)}, charged ${day(c.chargedAt)}` : (!isAdmin && c.charged ? ' · charged to the seller' : '')}
            </div>
            <ClaimPhotos claim={c} base="/api/admin/marketplace/claims/photos" canAdd onDone={() => window.location.reload()} />
            {c.notes.length > 0 && <ul style={{ fontSize: 13, paddingLeft: 18 }}>{c.notes.map((n, i) => <li key={i}>{day(n.at)} {n.author}{n.internal ? ' (internal)' : ''}{n.side === 'vendor' ? ' (seller)' : ''}: {n.note}</li>)}</ul>}
            {open && (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input placeholder="Add a note" value={s(c.id, 'note')} onChange={(e) => set(c.id, 'note', e.target.value)} style={{ width: 280 }} />
                  <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!s(c.id, 'internal')} onChange={(e) => set(c.id, 'internal', e.target.checked)} /> internal (seller will not see it)</label>
                  <button className="btn" disabled={busy || !s(c.id, 'note')} onClick={() => call({ action: 'note', id: c.id, note: s(c.id, 'note'), internal: !!s(c.id, 'internal') }, 'Note added.')}>Add note</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select value={s(c.id, 'res')} onChange={(e) => set(c.id, 'res', e.target.value)} style={{ width: 'auto' }}>
                    <option value="">Resolved by…</option>{Object.entries(rules.resolutions).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                  <button className="btn" disabled={busy || !s(c.id, 'res')} onClick={() => call({ action: 'resolve', id: c.id, resolution: s(c.id, 'res'), note: s(c.id, 'note') }, 'Claim resolved.')}>Mark resolved</button>
                  <input placeholder="Why close without a fix?" value={s(c.id, 'why')} onChange={(e) => set(c.id, 'why', e.target.value)} style={{ width: 220 }} />
                  <button className="btn" disabled={busy || !s(c.id, 'why')} onClick={() => confirm('Close this claim with no charge?') && call({ action: 'close', id: c.id, reason: s(c.id, 'why') }, 'Claim closed.')}>Close</button>
                </div>
              </div>)}
            {isAdmin && !c.chargedAt && c.status !== 'closed' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>Charge the seller:</strong>
                <input placeholder="$ we paid" value={s(c.id, 'amt')} onChange={(e) => set(c.id, 'amt', e.target.value)} style={{ width: 100 }} />
                <select value={s(c.id, 'kind') || 'guarantee_claim'} onChange={(e) => set(c.id, 'kind', e.target.value)} style={{ width: 'auto' }}>
                  <option value="guarantee_claim">We paid the customer (cash left our bank)</option>
                  <option value="chargeback">A cost of ours (repair we paid for)</option></select>
                <button className="btn danger" disabled={busy || !(Number(s(c.id, 'amt')) > 0)}
                  onClick={() => confirm(`Take $${Number(s(c.id, 'amt')).toFixed(2)} from the seller (warranty reserve first, then their balance)? This cannot be undone.`)
                    && call({ action: 'charge', id: c.id, dollars: Number(s(c.id, 'amt')), kind: s(c.id, 'kind') || 'guarantee_claim' }, 'Charged to the seller.')}>Charge</button>
              </div>)}
          </div>
        );
      })}
    </div>
  );
}
