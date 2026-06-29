'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Triggers an on-demand Meta ad-spend sync. Only rendered when Meta is connected.
export default function MetaSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function sync() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/sync-ads', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setMsg(`Synced ${data.synced} day(s).`);
      router.refresh();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" className="dash-filter active" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync Meta now'}</button>
      {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
    </span>
  );
}
