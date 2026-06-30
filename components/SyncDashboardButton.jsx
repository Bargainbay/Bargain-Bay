'use client';
import { useState } from 'react';

// One-click repair: backfill fulfilment orders for every paid invoice that's
// missing one, so older paid invoices show up in the dashboard's revenue.
export default function SyncDashboardButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function run() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill_all' })
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || 'Failed'); return; }
      setMsg(d.fixed ? `✓ Added ${d.fixed} paid invoice${d.fixed === 1 ? '' : 's'} to the dashboard.` : '✓ All paid invoices already show in the dashboard.');
      if (d.fixed) setTimeout(() => window.location.reload(), 1200);
    } catch {
      setMsg('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" disabled={busy} onClick={run}>{busy ? 'Syncing…' : 'Sync paid invoices to dashboard'}</button>
      {msg && <span style={{ fontSize: 13, color: msg.startsWith('✓') ? 'var(--green, #0f6e56)' : 'var(--danger, #c0392b)' }}>{msg}</span>}
    </span>
  );
}
