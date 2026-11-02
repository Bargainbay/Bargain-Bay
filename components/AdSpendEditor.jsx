'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// Add / list / delete ad spend rows. Posts to /api/admin/ad-spend.
export default function AdSpendEditor({ initial = [], channels = [], brands = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState({ spentOn: '', channel: channels[0] || 'Meta', amount: '', campaign: '', note: '', brand: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    if (!form.spentOn || !(Number(form.amount) > 0)) { setErr('Date and amount are required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/ad-spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setRows((r) => [{ id: data.id, ...form, amount: Number(form.amount) }, ...r]);
      setForm({ spentOn: '', channel: form.channel, amount: '', campaign: '', note: '', brand: form.brand });
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function assign(r, brand, scope) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/ad-spend', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, brand, scope }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not assign');
      setRows((all) => all.map((x) => (x.id === r.id || (scope === 'campaign' && x.channel === r.channel && (x.campaign || '') === (r.campaign || ''))) ? { ...x, brand: brand || null } : x));
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del(id) {
    setBusy(true);
    try {
      await fetch(`/api/admin/ad-spend?id=${id}`, { method: 'DELETE' });
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } finally { setBusy(false); }
  }

  const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13 };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} style={{ ...inp, width: 'auto' }} />
        <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} style={{ ...inp, width: 'auto' }}>
          {channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={{ ...inp, width: 'auto' }}>
          <option value="">Business…</option>
          {brands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <input type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ ...inp, width: 100 }} />
        <input placeholder="Campaign (optional)" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} style={{ ...inp, flex: '1 1 120px' }} />
        <button className="dash-filter active" disabled={busy} onClick={add}>{busy ? '…' : 'Add'}</button>
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
          <thead><tr><th>Date</th><th>Channel</th><th>Campaign</th><th>Business</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.spentOn}</td><td>{r.channel}</td><td>{r.campaign || '—'}</td>
                <td>
                  <select value={r.brand || ''} disabled={busy} onChange={(e) => assign(r, e.target.value, 'row')} style={{ ...inp, width: 'auto', borderColor: r.brand ? 'var(--line)' : 'var(--danger)' }}>
                    <option value="">Unassigned</option>
                    {brands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                  {r.campaign && <button className="dash-filter" disabled={busy || !r.brand} title="Apply this business to every row of this campaign" onClick={() => assign(r, r.brand, 'campaign')} style={{ marginLeft: 6 }}>whole campaign</button>}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.amount)}</td>
                <td style={{ textAlign: 'right' }}><button className="dash-filter" disabled={busy} onClick={() => del(r.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
