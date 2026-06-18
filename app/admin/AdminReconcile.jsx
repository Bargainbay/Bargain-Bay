'use client';
import { useState } from 'react';
import { money } from '../../lib/constants';

const CHANNELS = { order: 'Online order', invoice: 'CRM invoice', manual: 'Manual' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// Reconciliation checklist: units sold through the site/CRM that the owner still
// needs to mark Sold in the master tracker (until Google write-back is enabled).
export default function AdminReconcile({ initialItems = [] }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(null); // sku | '__all__'
  const [error, setError] = useState('');

  async function markDone(skus) {
    const tag = skus.length > 1 ? '__all__' : skus[0];
    setBusy(tag); setError('');
    try {
      const res = await fetch('/api/admin/reconcile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus })
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Update failed'); return; }
      const done = new Set(skus);
      setItems((xs) => xs.filter((x) => !done.has(x.sku)));
    } catch {
      setError('Network error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Tracker reconciliation ({items.length})</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        Units sold on the site or via a CRM invoice. They&apos;re already off the storefront — this is your
        checklist to mark them <b>Sold</b> in the master tracker so they don&apos;t reappear after the next
        import. Check one off once you&apos;ve updated the tracker.
      </p>
      {error && <div className="error-box">{error}</div>}
      {items.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>Nothing to reconcile — every sold unit is squared with the tracker.</div>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr><th>SKU</th><th>Unit</th><th>Sold</th><th>Via</th><th style={{ textAlign: 'right' }}>Price</th><th>
                <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy === '__all__'} onClick={() => markDone(items.map((x) => x.sku))}>
                  {busy === '__all__' ? 'Saving…' : 'Mark all done'}
                </button>
              </th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.sku}>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{it.sku}</td>
                  <td>{it.title || `${it.make || ''} ${it.model || ''}`.trim() || '—'}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{fmtDate(it.sold_at)}</td>
                  <td>
                    {CHANNELS[it.sold_channel] || it.sold_channel || '—'}
                    {it.sold_ref && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{it.sold_ref}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{it.sold_price == null ? '—' : money(it.sold_price)}</td>
                  <td>
                    <button className="btn primary" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === it.sku} onClick={() => markDone([it.sku])}>
                      {busy === it.sku ? 'Saving…' : 'Mark done'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
