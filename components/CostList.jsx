'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COST_FREQUENCIES, COST_CATEGORIES, dailyShare } from '../lib/daily-cost-math';

const money = (v) => `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const blank = () => ({ name: '', category: 'Rent', amount: '', frequency: 'monthly', startsOn: today(), endsOn: '', note: '' });
const input = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' };

// The cost list: each bill, how often it comes, and what that works out to per
// day. Amounts are BEFORE tax -- the HST is recovered, so it is not a cost.
export default function CostList({ costs }) {
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const total = costs.reduce((a, c) => a + dailyShare(c, today()), 0);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function send(body) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/recurring-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setForm(null); router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const preview = form && form.amount !== '' ? dailyShare({ amount: form.amount, frequency: form.frequency, starts_on: form.startsOn, ends_on: form.endsOn }, form.frequency === 'once' ? form.startsOn : today()) : null;

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Cost list</h1>
      <p className="hint">
        Every bill the business pays on a schedule. Each one is spread over the days it covers, and the total
        is the overhead on the <a href="/admin/daily-pnl">daily P&amp;L</a>. Enter amounts <b>before tax</b>.
        Don&apos;t add wages (they come from clock-ins and the driver app), or truck day rates and fuel
        (dispatch already counts those on the days a truck runs).
      </p>
      <p style={{ fontSize: 16 }}>Overhead today: <b>{money(total)}</b> a day</p>

      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Cost</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th>Billed</th><th style={{ textAlign: 'right' }}>Per day</th><th></th></tr></thead>
        <tbody>
          {costs.length === 0 && <tr><td colSpan={6} className="hint">Nothing yet. Add rent, hydro, insurance, software, loan payments…</td></tr>}
          {costs.map((c) => (
            <tr key={c.id}>
              <td>{c.name}{c.note ? <div className="hint">{c.note}</div> : null}</td>
              <td>{c.category}</td>
              <td style={{ textAlign: 'right' }}>{money(c.amount)}</td>
              <td>{COST_FREQUENCIES.find((f) => f.key === c.frequency)?.label}{c.ends_on ? ` until ${c.ends_on}` : ''}</td>
              <td style={{ textAlign: 'right' }}>{c.frequency === 'once' ? '—' : money(dailyShare(c, today()))}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="dash-filter" onClick={() => setForm({ id: c.id, name: c.name, category: c.category, amount: c.amount, frequency: c.frequency, startsOn: c.starts_on, endsOn: c.ends_on || '', note: c.note || '' })}>Edit</button>{' '}
                <button type="button" className="dash-filter" disabled={busy} onClick={() => { if (confirm(`Stop counting "${c.name}" from today? Past days keep it.`)) send({ action: 'remove', id: c.id }); }}>Stop</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {!form ? (
        <button type="button" className="dash-filter active" style={{ marginTop: 12 }} onClick={() => setForm(blank())}>+ Add a cost</button>
      ) : (
        <div style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: 520 }}>
          <b>{form.id ? 'Edit cost' : 'New cost'}</b>
          <input style={input} placeholder="Name (Rent, Hydro, Shopify…)" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <select style={input} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {COST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...input, flex: 1 }} type="number" min="0" step="0.01" inputMode="decimal" placeholder="Amount before tax" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            <select style={input} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
              {COST_FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label>{form.frequency === 'once' ? 'Date' : 'Starts'} <input style={input} type="date" value={form.startsOn} onChange={(e) => set('startsOn', e.target.value)} /></label>
            {form.frequency !== 'once' && <label>Ends (optional) <input style={input} type="date" value={form.endsOn} onChange={(e) => set('endsOn', e.target.value)} /></label>}
          </div>
          <input style={input} placeholder="Note (optional)" value={form.note} onChange={(e) => set('note', e.target.value)} />
          {preview != null && <span className="hint">{form.frequency === 'once' ? `Counted in full on ${form.startsOn}.` : `Works out to about ${money(preview)} a day.`}</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="dash-filter active" disabled={busy} onClick={() => send({ action: 'save', ...form })}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="dash-filter" onClick={() => setForm(null)}>Cancel</button>
            {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
