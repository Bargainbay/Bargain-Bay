'use client';
import { useEffect, useState } from 'react';

// Records that look like one person, and the one button that joins them.
//
// PROPOSES, NEVER MERGES. A household shares a phone and two people share a
// name, so this is a shortlist for somebody who knows them — not a job that can
// be run. And a merge cannot be undone: the other record is deleted and its
// identities move to the survivor.
//
// Which record SURVIVES is an explicit choice, not an ordering. It decides
// which address the customer keeps hearing from.
const line = (c) => [c.name, c.email, c.phone].filter(Boolean).join(' · ') || `#${c.id}`;

export default function DuplicateCustomers() {
  const [dupes, setDupes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState([]);

  const load = () => fetch('/api/admin/customers?duplicates=1')
    .then((r) => r.json()).then((d) => setDupes(d.duplicates || [])).catch(() => setDupes([]));
  useEffect(() => { load(); }, []);

  async function merge(keep, drop) {
    if (!window.confirm(
      `Keep ${line(keep)}\nand merge in ${line(drop)}?\n\n`
      + 'Their orders, invoices and quotes all move to the record you keep. '
      + 'This cannot be undone.'
    )) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', keep: keep.id, drop: drop.id })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Merge failed.'); return; }
      setDone((x) => [...x, `${line(drop)} → ${line(keep)}`]);
      await load();
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  if (!dupes) return <p className="hint">Looking for duplicates…</p>;

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {done.map((d, i) => <div key={i} className="notice-box" style={{ fontSize: 13 }}>✓ Merged {d}</div>)}

      {!dupes.length && <p className="hint" style={{ margin: 0 }}>No records look like duplicates.</p>}

      {dupes.map((d, i) => (
        <div key={i} className="panel" style={{ margin: '10px 0', padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            Same {d.why.replace('same ', '')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 200px', fontSize: 13.5 }}>{line(d.a)}</div>
            <div style={{ flex: '1 1 200px', fontSize: 13.5 }}>{line(d.b)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => merge(d.a, d.b)}>
              Keep the first
            </button>
            <button className="btn" disabled={busy} onClick={() => merge(d.b, d.a)}>
              Keep the second
            </button>
            <span className="hint" style={{ fontSize: 12, alignSelf: 'center' }}>
              — or leave them: two people can share a phone or a name.
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
