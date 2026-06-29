'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Manage the salesperson list (settings key 'sales_reps'). Once set, a rep
// dropdown appears on each order in Operations.
export default function RepsEditor({ current = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    const list = val.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sales_reps', value: list })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setOpen(false);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!open) {
    return <button type="button" className="dash-filter" onClick={() => setOpen(true)}>{current.length ? 'Edit team' : 'Add salespeople'}</button>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        value={val} autoFocus placeholder="Sean, Ravi, …"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }}
        style={{ width: 220, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' }}
      />
      <button type="button" className="dash-filter active" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="dash-filter" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
