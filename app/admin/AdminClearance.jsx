'use client';
import { useState } from 'react';
import { money } from '../../lib/constants';

// Clearance manager: search the catalog, mark a unit down, manage existing
// clearance rows. Talks to /api/admin/clearance (admin-gated).
export default function AdminClearance({ initialItems }) {
  const [items, setItems] = useState(initialItems || []);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState({}); // sku -> { price, warranty, note }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function search(e) {
    e.preventDefault();
    setSearching(true); setError('');
    try {
      const res = await fetch('/api/admin/clearance?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Search failed'); setResults([]); }
      else setResults(data.results || []);
    } catch { setError('Network error'); } finally { setSearching(false); }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/admin/clearance');
      const data = await res.json();
      if (res.ok) setItems(data.items || []);
    } catch {}
  }

  async function setClearance(sku, fallback) {
    const d = draft[sku] || {};
    const price = Number(d.price);
    if (!Number.isFinite(price) || price <= 0) { setError('Enter a clearance price for ' + sku); return; }
    setBusy(sku); setError('');
    try {
      const res = await fetch('/api/admin/clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku, price,
          warrantyMonths: d.warranty === '' || d.warranty == null ? 3 : Number(d.warranty),
          note: d.note || '',
          active: true
        })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Save failed'); return; }
      await refresh();
      setDraft((s) => ({ ...s, [sku]: {} }));
    } catch { setError('Network error'); } finally { setBusy(''); }
  }

  async function toggle(it) {
    setBusy(it.sku); setError('');
    try {
      const res = await fetch('/api/admin/clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: it.sku, price: it.price, warrantyMonths: it.warrantyMonths, note: it.note, active: !it.active })
      });
      if (res.ok) await refresh(); else setError((await res.json()).error || 'Update failed');
    } catch { setError('Network error'); } finally { setBusy(''); }
  }

  async function remove(sku) {
    setBusy(sku); setError('');
    try {
      const res = await fetch('/api/admin/clearance', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku })
      });
      if (res.ok) setItems((xs) => xs.filter((x) => x.sku !== sku));
      else setError((await res.json()).error || 'Remove failed');
    } catch { setError('Network error'); } finally { setBusy(''); }
  }

  function upd(sku, k, v) { setDraft((s) => ({ ...s, [sku]: { ...s[sku], [k]: v } })); }

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Clearance ({items.filter((i) => i.active).length} active)</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        Mark a unit down and it shows a <b>Clearance</b> badge, the slashed price, and a 3-month warranty
        across the store (homepage banner, /clearance, product page). Toggle off to hide without losing the markdown.
      </p>
      {error && <div className="error-box">{error}</div>}

      <form onSubmit={search} className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search a unit by make, model, SKU…"
          style={{ flex: '1 1 240px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 }}
        />
        <button className="btn primary" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {results.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="admin">
            <thead><tr><th>Unit</th><th>Retail</th><th>List</th><th>Clearance $</th><th>Warr (mo)</th><th></th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.sku}>
                  <td><b>{r.title}</b><div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.sku}</div></td>
                  <td>{r.retail ? money(r.retail) : '—'}</td>
                  <td>{r.listPrice ? money(r.listPrice) : '—'}</td>
                  <td><input type="number" step="0.01" value={(draft[r.sku] || {}).price || ''} onChange={(e) => upd(r.sku, 'price', e.target.value)} style={{ width: 90, padding: '5px 7px', border: '1px solid var(--line)', borderRadius: 6 }} /></td>
                  <td><input type="number" value={(draft[r.sku] || {}).warranty ?? 3} onChange={(e) => upd(r.sku, 'warranty', e.target.value)} style={{ width: 56, padding: '5px 7px', border: '1px solid var(--line)', borderRadius: 6 }} /></td>
                  <td><button className="btn primary" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === r.sku} onClick={() => setClearance(r.sku)}>{busy === r.sku ? '…' : 'Set'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ color: 'var(--charcoal)', marginTop: 22, fontSize: 15 }}>Current clearance units</h3>
      {items.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>Nothing on clearance yet. Search above to add a unit.</div>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>Unit</th><th>Clearance $</th><th>Retail</th><th>Warr</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.sku}>
                  <td><b>{it.title}</b><div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{it.sku}</div></td>
                  <td><b>{money(it.price)}</b></td>
                  <td>{it.retail ? money(it.retail) : '—'}</td>
                  <td>{it.warrantyMonths} mo</td>
                  <td>{it.active ? <span className="pill clearance-pill">active</span> : <span className="pill sold">hidden</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === it.sku} onClick={() => toggle(it)}>{it.active ? 'Hide' : 'Show'}</button>{' '}
                    <button className="btn danger" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busy === it.sku} onClick={() => remove(it.sku)}>Remove</button>
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
