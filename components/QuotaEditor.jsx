'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Admin-only: set this month's targets for each rep. Blank = no target for that
// measure (not zero). A quota set now stays in force every month after until it
// is changed, so this is a standing number, not a monthly chore.
const FIELDS = [
  ['revenue', 'Revenue $'], ['sales', 'Sales #'], ['ownRevenue', 'Own-lead revenue $'], ['ownSales', 'Own-lead sales #']
];

export default function QuotaEditor({ rows = [], monthLabel = '' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const init = () => Object.fromEntries(rows.map((r) => [r.name, Object.fromEntries(FIELDS.map(([f]) => [f, r.quota?.[f] ?? '']))]));
  const [vals, setVals] = useState(init);

  async function save() {
    setBusy(true); setErr('');
    try {
      const quotas = rows.map((r) => ({ rep: r.name, ...vals[r.name] }));
      const res = await fetch('/api/admin/quotas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quotas }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setOpen(false); router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="dash-filter" onClick={() => { setVals(init()); setOpen(true); }}>Set quotas</button>;
  return (
    <div style={{ flexBasis: '100%', marginTop: 12 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Targets for <b>{monthLabel}</b> and every month after, until you change them. Leave a box empty for no target.
        Own-lead = sales where the &ldquo;sent by&rdquo; name is the rep.
      </p>
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Rep</th>{FIELDS.map(([f, l]) => <th key={f} style={{ textAlign: 'right' }}>{l}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key}>
            <td>{r.name}</td>
            {FIELDS.map(([f, l]) => (
              <td key={f} style={{ textAlign: 'right' }}>
                <input type="number" min="0" step={f.endsWith('Sales') || f === 'sales' ? 1 : 100} inputMode="decimal" aria-label={`${r.name} ${l}`}
                  value={vals[r.name]?.[f] ?? ''} placeholder="—"
                  onChange={(e) => setVals((v) => ({ ...v, [r.name]: { ...v[r.name], [f]: e.target.value } }))}
                  style={{ width: 110, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', textAlign: 'right' }} />
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="dash-filter active" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save quotas'}</button>
        <button type="button" className="dash-filter" onClick={() => setOpen(false)}>Cancel</button>
        {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  );
}
