'use client';
import { useState, useEffect } from 'react';
import { money } from '../../lib/constants';

const CATEGORIES = ['Refrigerator', 'Range', 'Washer', 'Dryer', 'Dishwasher', 'Freezer', 'Microwave', 'Range Hood', 'Other'];
const CONDITIONS = ['New Open Box', 'Scratch & Dent', 'Refurbished', 'Used'];
const blank = { make: '', model: '', category: 'Refrigerator', condition: '', retail: '', cost: '', vendor: '', invoice: '', qty: '1' };

// Inventory intake — writes straight into the master Google tracker. New units
// land as "Untested" (off the storefront); confirming tested-working flips Status
// to "Tested Working" and syncs, so the website live-updates. Prices auto-fill
// from the tracker's condition tiers.
export default function AdminIntake() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blank);
  const [haulaway, setHaulaway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cond, setCond] = useState({}); // sku -> condition for publish

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/intake');
      const data = await res.json();
      setPending(data.units || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13.5 };

  async function add() {
    if (!form.make && !form.model) { setErr('Enter at least a make or model.'); return; }
    setBusy(true); setErr('');
    const body = { ...form, source: haulaway ? 'Haulaway' : '', cost: haulaway ? 0 : form.cost };
    try {
      const res = await fetch('/api/admin/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setForm({ ...blank, category: form.category });
      await refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function act(sku, action) {
    setBusy(true); setErr('');
    try {
      const body = action === 'reject' ? { sku, action: 'reject' } : { sku, action: 'tested', condition: cond[sku] || undefined };
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
        This writes a row to your <b>master tracker</b> as <b>Untested</b> (Condition %, price &amp; totals auto-fill from your tiers).
        It stays off the storefront until you confirm it&apos;s <b>tested working</b>, then it goes live automatically.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} style={{ ...inp, width: 120 }} />
        <input placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={{ ...inp, width: 140 }} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inp }}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...inp }} title="Optional now; sets the price tier. You can also set it when publishing.">
          <option value="">Condition…</option>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min="0" step="0.01" placeholder="Retail $" value={form.retail} onChange={(e) => setForm({ ...form, retail: e.target.value })} style={{ ...inp, width: 90 }} title="Retail/MSRP — the sale price is derived from this × condition tier." />
        {!haulaway && <input type="number" min="0" step="0.01" placeholder="Cost ea." value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} style={{ ...inp, width: 84 }} />}
        {!haulaway && <input placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} style={{ ...inp, width: 110 }} />}
        <input type="number" min="1" max="50" placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ ...inp, width: 60 }} />
        <label style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Acquired free on one of our deliveries — cost 0, vendor Haulaway.">
          <input type="checkbox" style={{ width: 'auto' }} checked={haulaway} onChange={(e) => setHaulaway(e.target.checked)} /> Haul-away
        </label>
        <button className="btn primary" style={{ padding: '7px 14px' }} disabled={busy} onClick={add}>{busy ? '…' : 'Add to tracker'}</button>
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}

      <h3 style={{ color: 'var(--charcoal)', margin: '18px 0 8px' }}>Pending — tested working? ({pending.length})</h3>
      {loading ? (
        <p className="hint" style={{ marginTop: 0 }}>Loading from the tracker…</p>
      ) : pending.length === 0 ? (
        <p className="hint" style={{ marginTop: 0 }}>Nothing at &quot;Untested&quot; right now. Added units appear here until you publish them.</p>
      ) : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Unit</th><th>SKU</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Retail</th><th>Condition</th><th /></tr></thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u.sku}>
                <td>{u.title}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.category}</div></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.sku}</td>
                <td style={{ textAlign: 'right' }}>{u.cost ? money(u.cost) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{u.retail ? money(u.retail) : '—'}</td>
                <td>
                  <select value={cond[u.sku] || u.condition || ''} onChange={(e) => setCond((c) => ({ ...c, [u.sku]: e.target.value }))} style={{ ...inp, padding: '5px 7px' }}>
                    <option value="">Condition…</option>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn primary" style={{ padding: '4px 10px', fontSize: 12.5 }} disabled={busy} onClick={() => act(u.sku, 'tested')}>✓ Tested · publish</button>
                  <button className="btn" style={{ padding: '4px 9px', fontSize: 12.5, marginLeft: 6 }} disabled={busy} onClick={() => act(u.sku, 'reject')}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>Publishing sets Status = &quot;Tested Working&quot; in the tracker and syncs the site. The sale price comes from your tracker&apos;s condition tiers.</p>
    </div>
  );
}
