'use client';
import { useState } from 'react';
import { money } from '../../lib/constants';

const CATEGORIES = ['Refrigerator', 'Range', 'Washer', 'Dryer', 'Dishwasher', 'Freezer', 'Microwave', 'Range Hood', 'Other'];
const CONDITIONS = ['New Open Box', 'Scratch & Dent', 'Refurbished', 'Used'];
const blank = { make: '', model: '', category: 'Refrigerator', condition: 'Scratch & Dent', cost: '', source: '', qty: '1' };

// Inventory intake: add newly-acquired units (vendor purchase or haul-away) as
// pending, then publish each once an owner confirms it's tested-working.
export default function AdminIntake({ initial = [] }) {
  const [pending, setPending] = useState(initial);
  const [form, setForm] = useState(blank);
  const [haulaway, setHaulaway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [prices, setPrices] = useState({}); // sku -> price input

  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13.5 };

  async function add() {
    if (!form.make && !form.model) { setErr('Enter at least a make or model.'); return; }
    setBusy(true); setErr('');
    const body = { ...form, source: haulaway ? 'Haulaway' : form.source, cost: haulaway ? 0 : form.cost };
    try {
      const res = await fetch('/api/admin/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      // refresh list
      const list = await (await fetch('/api/admin/intake')).json();
      setPending(list.units || []);
      setForm({ ...blank, category: form.category });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function act(sku, action) {
    setBusy(true); setErr('');
    try {
      const body = action === 'reject' ? { sku, action: 'reject' } : { sku, price: Number(prices[sku]) };
      const res = await fetch('/api/admin/intake', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setPending((p) => p.filter((u) => u.sku !== sku));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Inventory intake</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Add units you&apos;ve just acquired — a vendor purchase (e.g. a SecondShop invoice) or a haul-away to fix &amp; resell.
        They&apos;re held off the storefront until you confirm they&apos;re <b>tested working</b>, then go live and become invoiceable. No spreadsheet needed.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} style={{ ...inp, width: 120 }} />
        <input placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={{ ...inp, width: 140 }} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inp }}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...inp }}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {!haulaway && <input type="number" min="0" step="0.01" placeholder="Cost ea." value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} style={{ ...inp, width: 90 }} />}
        {!haulaway && <input placeholder="Vendor / source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={{ ...inp, width: 130 }} />}
        <input type="number" min="1" max="50" placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ ...inp, width: 64 }} />
        <label style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Acquired free on one of our deliveries — cost 0, source Haulaway.">
          <input type="checkbox" style={{ width: 'auto' }} checked={haulaway} onChange={(e) => setHaulaway(e.target.checked)} /> Haul-away
        </label>
        <button className="btn primary" style={{ padding: '7px 14px' }} disabled={busy} onClick={add}>{busy ? '…' : 'Add'}</button>
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}

      <h3 style={{ color: 'var(--charcoal)', margin: '18px 0 8px' }}>Pending — tested working? ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="hint" style={{ marginTop: 0 }}>Nothing waiting. Added units appear here until you publish them.</p>
      ) : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Unit</th><th>SKU</th><th>Source</th><th style={{ textAlign: 'right' }}>Cost</th><th>Sale price</th><th /></tr></thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u.sku}>
                <td>{u.title}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.category} · {u.condition || '—'}</div></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.sku}</td>
                <td>{u.source || '—'}</td>
                <td style={{ textAlign: 'right' }}>{u.cost ? money(u.cost) : '—'}</td>
                <td>
                  <input type="number" min="0" step="0.01" placeholder="$ price" value={prices[u.sku] || ''}
                    onChange={(e) => setPrices((p) => ({ ...p, [u.sku]: e.target.value }))}
                    style={{ ...inp, width: 90 }} />
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn primary" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy || !(Number(prices[u.sku]) > 0)} onClick={() => act(u.sku, 'tested')}>✓ Tested · publish</button>
                  <button className="btn" style={{ padding: '4px 9px', fontSize: 12.5, marginLeft: 6 }} disabled={busy} onClick={() => act(u.sku, 'reject')}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
