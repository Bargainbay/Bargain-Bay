'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Vendor → category (and optionally tax treatment).
//
// A bank feed and an uncategorised QuickBooks both hand over the same thing: a
// merchant name and an amount. Sorting thousands of those by hand is the job
// nobody does, so it doesn't get done and the P&L reads "Other: $40,000". One
// rule per supplier fixes it once, for every transaction that supplier ever
// sends again.
//
// The tax column is opt-in on purpose. Setting it says "I know this supplier and
// they charge HST" — the owner's judgement, not a guess. Leave it blank and the
// row still goes to the review queue.
const TAX_MODES = { '': 'Ask me (review queue)', hst: 'HST included at 13%', none: 'No recoverable tax' };

export default function ExpenseRules({ initial = [], categories = [], ledgerStart }) {
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [form, setForm] = useState({ match: '', category: categories[0] || 'Other', taxMode: '' });
  const [start, setStart] = useState(ledgerStart || '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function post(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/expense-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'That failed.');
      return d;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(''); }
  }

  async function add() {
    if (!form.match.trim()) { setErr('Type part of the vendor name to match on.'); return; }
    const d = await post({ action: 'save', ...form }, 'add');
    if (!d) return;
    setRules(d.rules);
    setForm({ match: '', category: form.category, taxMode: form.taxMode });
    setMsg('Rule saved. Run “Apply to existing rows” to sort what’s already here.');
    router.refresh();
  }

  async function remove(id) {
    const d = await post({ action: 'delete', id }, `del${id}`);
    if (d) { setRules(d.rules); router.refresh(); }
  }

  async function applyAll() {
    const d = await post({ action: 'apply' }, 'apply');
    if (!d) return;
    setMsg(d.categorised || d.taxed
      ? `Sorted ${d.categorised} row(s) into categories and answered HST on ${d.taxed}.`
      : 'Nothing left for these rules to sort.');
    router.refresh();
  }

  async function saveStart() {
    const d = await post({ action: 'ledger_start', ledgerStart: start }, 'start');
    if (d) { setMsg(`Feeds will ignore anything before ${d.ledgerStart}.`); router.refresh(); }
  }

  const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13 };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Match part of a vendor name and every transaction from them lands in the right category from now on —
        the bank feed and QuickBooks both go through these. Longest match wins, so
        <code> canadian tire gas</code> beats <code>canadian tire</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Vendor contains… (e.g. esso)" value={form.match}
          onChange={(e) => setForm({ ...form, match: e.target.value })} style={{ ...inp, width: 200 }} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inp, width: 'auto' }}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={form.taxMode} onChange={(e) => setForm({ ...form, taxMode: e.target.value })} style={{ ...inp, width: 'auto' }}
          title="Only set this for a supplier you're sure about — it decides an input tax credit.">
          {Object.entries(TAX_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="dash-filter active" disabled={!!busy} onClick={add}>{busy === 'add' ? '…' : 'Add rule'}</button>
        {rules.length > 0 && (
          <button className="dash-filter" disabled={!!busy} onClick={applyAll}
            title="Runs every rule over expenses already in the ledger. Only fills blanks — anything you set by hand stays.">
            {busy === 'apply' ? 'Sorting…' : 'Apply to existing rows'}
          </button>
        )}
      </div>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}

      {rules.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="admin">
            <thead><tr><th>Vendor contains</th><th>Category</th><th>HST</th><th style={{ textAlign: 'right' }}>Used</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.match}</code></td>
                  <td>{r.category || <span style={{ color: 'var(--muted)' }}>— unchanged —</span>}</td>
                  <td>{TAX_MODES[r.taxMode || '']}</td>
                  <td style={{ textAlign: 'right' }}>{r.hits || 0}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="dash-filter" disabled={!!busy} onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--charcoal)' }}>Where the books start</h3>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          The bank feed and QuickBooks ignore anything dated before this. Everything earlier belongs to whatever
          you were running on then, and importing it would give you a P&amp;L stitched from two systems. Typing an
          expense by hand, or uploading a purchase invoice, is never capped — that&apos;s a deliberate act.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...inp, width: 'auto' }} />
          <button className="dash-filter" disabled={!!busy || !start} onClick={saveStart}>
            {busy === 'start' ? '…' : 'Save start date'}
          </button>
        </div>
      </div>
    </div>
  );
}
