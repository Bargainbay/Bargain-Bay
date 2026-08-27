'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// The patterns hiding in the bank feed, offered one decision at a time.
//
// Two thousand transactions are rarely two thousand different things — they're
// thirty patterns repeated. Ranked by money rather than by count, because ten
// $2,000 supplier transfers deserve attention before forty $4 coffees.
const TAX_MODES = { '': 'Ask me (review queue)', hst: 'HST included at 13%', none: 'No recoverable tax' };

export default function RuleSuggestions({ initial = [], categories = [] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const set = (token, k, v) => setDraft((d) => ({ ...d, [token]: { ...(d[token] || {}), [k]: v } }));
  const valueOf = (token, k, fallback) => (draft[token]?.[k] ?? fallback);

  async function create(g) {
    const category = valueOf(g.token, 'category', categories[0] || 'Other');
    const taxMode = valueOf(g.token, 'taxMode', '');
    setBusy(g.token); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/expense-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Created AND applied in one go: a rule that leaves the rows that
        // prompted it sitting there is half a feature.
        body: JSON.stringify({ action: 'save_and_apply', match: g.token, category, taxMode })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      setRows((r) => r.filter((x) => x.token !== g.token));
      setMsg(`“${g.token}” → ${category}. Sorted ${d.categorised} row(s)${d.taxed ? `, answered HST on ${d.taxed}` : ''}.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  if (!rows.length) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        No repeating patterns left to turn into rules — either everything is sorted, or what&apos;s left is one-offs.
      </p>
    );
  }

  const totalCovered = rows.reduce((a, r) => a + r.count, 0);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>{rows.length}</b> repeating pattern{rows.length === 1 ? '' : 's'} across <b>{totalCovered}</b> unsorted
        transaction{totalCovered === 1 ? '' : 's'}, biggest money first. Each one you accept becomes a permanent rule —
        it sorts what&apos;s already here and everything that supplier sends from now on.
      </p>

      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="admin">
          <thead>
            <tr>
              <th>Pattern</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Category</th>
              <th>HST</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.token}>
                <td>
                  <code>{g.token}</code>
                  {/* The actual descriptors behind the pattern. Without these
                      "supp" is a guess; with them it's obviously the supplier
                      e-transfers. */}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                    {g.samples.join(' · ')}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>{g.count}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(g.total)}</td>
                <td>
                  <select value={valueOf(g.token, 'category', categories[0] || 'Other')}
                    onChange={(e) => set(g.token, 'category', e.target.value)}
                    style={{ fontSize: 12.5, width: 'auto' }}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td>
                  <select value={valueOf(g.token, 'taxMode', '')}
                    onChange={(e) => set(g.token, 'taxMode', e.target.value)}
                    title="Only set this for a supplier you're sure about — it decides an input tax credit."
                    style={{ fontSize: 12.5, width: 'auto' }}>
                    {Object.entries(TAX_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="dash-filter active" disabled={!!busy} onClick={() => create(g)}>
                    {busy === g.token ? '…' : 'Create rule'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
