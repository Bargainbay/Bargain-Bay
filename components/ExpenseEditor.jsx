'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// Add / list / delete operating expenses, plus recurring templates (rent,
// storage, subscriptions) that auto-post each cycle. Posts to /api/admin/expenses.
export default function ExpenseEditor({ initial = [], recurringInitial = [], categories = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [recurring, setRecurring] = useState(recurringInitial);
  const [form, setForm] = useState({ incurredOn: '', category: categories[0] || 'Other', vendor: '', amount: '', note: '' });
  const [rform, setRform] = useState({ category: categories[0] || 'Other', vendor: '', amount: '', cadence: 'monthly', dayOf: 1 });
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

  async function addRecurring() {
    if (!(Number(rform.amount) > 0)) { setErr('Amount is required for a recurring expense.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rform, recurring: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setRecurring((r) => [...r, { id: data.id, ...rform, amount: Number(rform.amount), dayOf: Number(rform.dayOf) || 1 }]);
      setRform({ category: rform.category, vendor: '', amount: '', cadence: rform.cadence, dayOf: rform.dayOf });
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function delRecurring(id) {
    setBusy(true);
    try {
      await fetch(`/api/admin/expenses?id=${id}&recurring=1`, { method: 'DELETE' });
      setRecurring((r) => r.filter((x) => x.id !== id));
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
                <td>{r.incurredOn}</td>
                <td>{r.category}{r.source === 'qbo' && <span className="pill" style={{ fontSize: 10, marginLeft: 5 }} title="Pulled from QuickBooks automatically">QB</span>}</td>
                <td>{r.vendor || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.amount)}</td>
                <td style={{ textAlign: 'right' }}>
                  {/* A QuickBooks row would just re-sync if deleted — fix it in QBO instead. */}
                  {r.source === 'qbo'
                    ? <span className="hint" style={{ fontSize: 11 }}>edit in QB</span>
                    : <button className="dash-filter" disabled={busy} onClick={() => del(r.id)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--charcoal)' }}>Recurring expenses</h3>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Rent, storage, subscriptions — set once and they post themselves every cycle. No more forgetting fixed costs.
          (If QuickBooks is connected and the cost already comes out of a linked bank account or card, don&apos;t also add it
          here — the bank feed brings it in and it would count twice.)
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={rform.category} onChange={(e) => setRform({ ...rform, category: e.target.value })} style={{ ...inp, width: 'auto' }}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Vendor (e.g. landlord)" value={rform.vendor} onChange={(e) => setRform({ ...rform, vendor: e.target.value })} style={{ ...inp, width: 150 }} />
          <input type="number" min="0" step="0.01" placeholder="Amount" value={rform.amount} onChange={(e) => setRform({ ...rform, amount: e.target.value })} style={{ ...inp, width: 100 }} />
          <select value={rform.cadence} onChange={(e) => setRform({ ...rform, cadence: e.target.value })} style={{ ...inp, width: 'auto' }}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly (Mondays)</option>
          </select>
          {rform.cadence === 'monthly' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
              on day
              <input type="number" min="1" max="28" value={rform.dayOf} onChange={(e) => setRform({ ...rform, dayOf: e.target.value })} style={{ ...inp, width: 60 }} />
            </label>
          )}
          <button className="dash-filter active" disabled={busy} onClick={addRecurring}>{busy ? '…' : 'Add recurring'}</button>
        </div>
        {recurring.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
            <thead><tr><th>Category</th><th>Vendor</th><th>Repeats</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
            <tbody>
              {recurring.map((r) => (
                <tr key={r.id}>
                  <td>{r.category}</td><td>{r.vendor || '—'}</td>
                  <td>{r.cadence === 'weekly' ? 'Weekly (Mon)' : `Monthly · day ${r.dayOf}`}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.amount)}</td>
                  <td style={{ textAlign: 'right' }}><button className="dash-filter" disabled={busy} onClick={() => delRecurring(r.id)}>Stop</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
