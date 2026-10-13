'use client';
import { useState } from 'react';

// Sales against the tracker, on demand. Anything with money paid must be Sold on
// the tracker and every sold unit must have a cost; this checks, fixes what it
// can, proves the fix, and lists what a person still has to do.
export default function SaleIntegrity() {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/sale-integrity', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setR(d);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Check sales against the tracker</h2>
      <p className="hint">
        Anything with money paid against it must say <b>Sold</b> on the tracker and be off the website, and every sold unit must have a cost.
        This runs by itself every 20 minutes and tells you if anything is wrong; this button runs it now.
      </p>
      <button type="button" className="dash-filter active" disabled={busy} onClick={run}>{busy ? 'Checking the tracker…' : 'Check now'}</button>
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {r && (
        <div style={{ marginTop: 12 }}>
          {r.fixed?.length > 0 && <p style={{ color: 'var(--ok)' }}><b>Fixed and confirmed on the tracker: {r.fixed.length}</b> — {r.fixed.map((f) => `${f.sku} (${f.invoice}, was ${f.was})`).join('; ')}</p>}
          {r.costsFilled > 0 && <p style={{ color: 'var(--ok)' }}><b>Costs filled from the tracker: {r.costsFilled}</b></p>}
          {r.problems?.length ? (
            <div style={{ border: '2px solid var(--danger)', borderRadius: 10, padding: 12 }}>
              <b>{r.problems.length} thing{r.problems.length === 1 ? '' : 's'} need a person:</b>
              <ul style={{ margin: '6px 0 0 18px' }}>{r.problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
            </div>
          ) : <p style={{ color: 'var(--ok)' }}><b>Everything agrees:</b> every unit with money paid is Sold on the tracker, and every sold unit has a cost.</p>}
        </div>
      )}
    </div>
  );
}
