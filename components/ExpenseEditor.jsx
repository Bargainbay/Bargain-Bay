'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// Add / list / delete operating expenses. Posts to /api/admin/expenses.
export default function ExpenseEditor({ initial = [], categories = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState({ incurredOn: '', category: categories[0] || 'Other', vendor: '', amount: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    if (!form.incurredOn || !(Number(form.amount) > 0)) { setErr('Date and amount are required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setRows((r) => [{ id: data.id, ...form, amount: Number(form.amount) }, ...r]);
      setForm({ incurredOn: '', category: form.category, vendor: '', amount: '', note: '' });
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del(id) {
    setBusy(true);
    try {
      await fetch(`/api/admin/expenses?id=${id}`, { method: 'DELETE' });
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } finally { setBusy(false); }
  }

  const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13 };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} style={{ ...inp, width: 'auto' }} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inp, width: 'auto' }}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} style={{ ...inp, width: 120 }} />
        <input type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ ...inp, width: 100 }} />
        <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...inp, flex: '1 1 120px' }} />
        <button className="dash-filter active" disabled={busy} onClick={add}>{busy ? '…' : 'Add'}</button>
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
          <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.incurredOn}</td><td>{r.category}</td><td>{r.vendor || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div></td>
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
