'use client';
import { useState } from 'react';
import { money } from '../../lib/constants';

// Salvage / parts-only units: sync from the tracker, then invoice selected units
// (bulk or single) to a buyer — which marks them disposed and records revenue.
export default function AdminSalvage({ initial }) {
  const [available, setAvailable] = useState(initial?.available || []);
  const [disposed, setDisposed] = useState(initial?.disposed || []);
  const [stats, setStats] = useState(initial?.stats || {});
  const [sel, setSel] = useState({}); // sku -> price string
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [addHst, setAddHst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function apply(d) { setAvailable(d.available || []); setDisposed(d.disposed || []); setStats(d.stats || {}); }
  const toggle = (sku) => setSel((s) => { const n = { ...s }; if (sku in n) delete n[sku]; else n[sku] = ''; return n; });
  const setPrice = (sku, v) => setSel((s) => ({ ...s, [sku]: v }));
  const chosen = Object.keys(sel);
  const total = chosen.reduce((a, sku) => a + (Number(sel[sku]) || 0), 0);

  async function sync() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/salvage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
      const d = await res.json();
      if (!res.ok) { setMsg('✗ ' + (d.error || 'Sync failed')); return; }
      apply(d); setMsg(`✓ Synced ${d.synced} salvage units from the tracker.`);
    } catch { setMsg('✗ Network error'); } finally { setBusy(false); }
  }

  async function invoice() {
    const items = chosen.map((sku) => {
      const u = available.find((x) => x.sku === sku) || {};
      return { sku, description: `Salvage — ${u.title || `${u.make || ''} ${u.model || ''}`.trim()} (${sku})`, amount: Number(sel[sku]) };
    });
    if (!items.length || items.some((it) => !(it.amount > 0))) { setMsg('✗ Select units and enter a price for each.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/salvage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invoice', name, email, addHst, items }) });
      const d = await res.json();
      if (!res.ok) { setMsg('✗ ' + (d.error || 'Invoice failed')); return; }
      apply(d); setSel({}); setName(''); setEmail('');
      setMsg(`✓ Salvage invoice ${d.invoice?.number} sent to ${email} — ${items.length} unit(s) marked disposed.`);
    } catch { setMsg('✗ Network error'); } finally { setBusy(false); }
  }

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Salvage / parts units ({available.length})</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        "Salvage For Parts Only" units from the tracker (never on the storefront). Sync to refresh, then select units,
        set a price each, and invoice a buyer — one invoice can cover many units (bulk) or just one. Invoicing marks
        them disposed and records salvage revenue.
      </p>

      <div className="panel">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: available.length ? 12 : 0 }}>
          <button className="btn primary" disabled={busy} onClick={sync}>{busy ? 'Working…' : 'Sync salvage from tracker'}</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Salvage revenue to date: <b style={{ color: 'var(--charcoal)' }}>{money(stats.salvageRevenue || 0)}</b> · {stats.disposedCount || 0} disposed</span>
          {msg && <span style={{ fontSize: 13, fontWeight: 600, flexBasis: '100%' }}>{msg}</span>}
        </div>

        {available.length > 0 && (
          <>
            <div className="form-2col" style={{ marginBottom: 10 }}>
              <div className="field"><label>Buyer name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scrapper / parts buyer" /></div>
              <div className="field"><label>Buyer email *</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com" /></div>
            </div>
            <div className="table-wrap">
              <table className="admin">
                <thead><tr><th></th><th>SKU</th><th>Unit</th><th style={{ textAlign: 'right' }}>Cost</th><th>Price (CAD)</th></tr></thead>
                <tbody>
                  {available.map((u) => {
                    const on = u.sku in sel;
                    return (
                      <tr key={u.sku} style={on ? { background: '#f4f7fc' } : undefined}>
                        <td><input type="checkbox" style={{ width: 'auto' }} checked={on} onChange={() => toggle(u.sku)} /></td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{u.sku}</td>
                        <td>{u.title || `${u.make || ''} ${u.model || ''}`.trim() || '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{u.cost == null ? '—' : money(u.cost)}</td>
                        <td><input type="number" min="0" step="0.01" style={{ width: 110 }} disabled={!on} value={sel[u.sku] || ''} onChange={(e) => setPrice(u.sku, e.target.value)} placeholder="0.00" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={addHst} onChange={(e) => setAddHst(e.target.checked)} /> Add 13% HST
              </label>
              <div style={{ fontSize: 14 }}>
                {chosen.length} selected · <b>{money(total)}</b>{addHst ? ' + HST' : ''}
                <button className="btn accent" style={{ marginLeft: 12 }} disabled={busy || !chosen.length} onClick={invoice}>
                  {busy ? 'Sending…' : 'Create salvage invoice'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {disposed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Disposed salvage ({disposed.length}) · {money(stats.salvageRevenue || 0)}</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="admin">
              <thead><tr><th>SKU</th><th>Unit</th><th>Invoice</th><th style={{ textAlign: 'right' }}>Sold for</th><th>Disposed</th></tr></thead>
              <tbody>
                {disposed.map((u) => (
                  <tr key={u.sku}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{u.sku}</td>
                    <td>{u.title || `${u.make || ''} ${u.model || ''}`.trim() || '—'}</td>
                    <td>{u.invoice_number || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{u.sale_price == null ? '—' : money(u.sale_price)}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{u.disposed_at ? new Date(u.disposed_at).toLocaleDateString('en-CA') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
