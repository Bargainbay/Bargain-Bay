'use client';
// Set the monthly targets the "Targets" table is judged against.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FinanceTargets({ targets }) {
  const router = useRouter();
  const [v, setV] = useState({ revenue: targets.revenue ?? '', gross: targets.gross ?? '', net: targets.net ?? '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/finance-targets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save.');
      setMsg('Saved.');
      router.refresh();
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
      {[['revenue', 'Monthly sales target'], ['gross', 'Monthly gross profit target'], ['net', 'Monthly net profit target']].map(([k, label]) => (
        <label key={k} style={{ fontSize: 13 }}>{label}
          <input type="number" min="0" step="100" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={{ display: 'block' }} />
        </label>
      ))}
      <button className="btn accent" disabled={busy}>{busy ? 'Saving…' : 'Save targets'}</button>
      {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
    </form>
  );
}
