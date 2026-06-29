'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Inline editor for the monthly revenue goal. Saves to /api/admin/settings
// (key 'revenue_goal_monthly') then refreshes the server-rendered dashboard.
export default function GoalEditor({ current }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n) || n < 0) { setErr('Enter a dollar amount.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'revenue_goal_monthly', value: n })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setOpen(false);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button type="button" className="dash-filter" onClick={() => setOpen(true)}>
        {current ? 'Edit goal' : 'Set monthly goal'}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>$</span>
      <input
        type="number" min="0" step="100" value={val} autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }}
        style={{ width: 120, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' }}
      />
      <button type="button" className="dash-filter active" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" className="dash-filter" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
