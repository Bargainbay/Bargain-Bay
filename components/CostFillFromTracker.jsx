'use client';
import { useState } from 'react';

const money = (v) => `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Invoice lines with NO cost at all (sold before the site imported the unit),
// where the master tracker states one. Preview, then copy the tracker's cost on.
export default function CostFillFromTracker({ initial }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  async function preview() {
    setBusy(true); setErr(''); setDone(null);
    try {
      const r = await fetch('/api/admin/cost-audit?kind=missing');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setData(d);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function apply() {
    if (!confirm(`Copy the tracker cost onto ${data.lines.length} invoice lines (and their orders)?\n\nThis changes profit figures for past days.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/cost-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, kind: 'missing', lineIds: data.lines.map((l) => l.id) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setDone(d); setData(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Fill missing costs from the tracker</h2>
      <p className="hint">
        A unit sold before the site imported it (still Untested, or in cleaning) has no cost on the site, so the sale counts as pure profit.
        The tracker does have the cost. This copies it onto the invoice line and its order. It re-reads the tracker when you apply, and only
        touches lines where the tracker actually states a cost.
      </p>
      {done ? (
        <div style={{ border: '2px solid var(--ok)', borderRadius: 12, padding: 14 }}>
          <b>Done.</b> Filled {done.invoiceLines} invoice lines and {done.orderLines} order lines.
          {done.skipped > 0 && <> {done.skipped} were skipped (no longer blank, or the tracker has no cost).</>}
        </div>
      ) : !data ? (
        <>
          {initial?.error
            ? <p style={{ color: 'var(--warn)' }}>Couldn&apos;t read the tracker just now. Try the preview again.</p>
            : initial ? <p style={{ fontSize: 16 }}>{initial.lines
              ? <><b>{initial.lines}</b> invoice lines have no cost, and the tracker has it: <b>{money(initial.costToAdd)}</b> to add.</>
              : <>No lines are missing a cost the tracker could fill.</>}
              {initial.noTrackerCost > 0 && <span className="hint"> {initial.noTrackerCost} more have no cost on the tracker either and need a person.</span>}</p> : null}
          <button type="button" className="dash-filter active" disabled={busy} onClick={preview}>{busy ? 'Reading the tracker…' : 'Preview'}</button>
        </>
      ) : (
        <>
          <p><b>{data.lines.length} invoice lines</b> will get the tracker cost, adding <b>{money(data.summary.costToAdd)}</b> of cost.
            {data.summary.noTrackerCost > 0 && <span className="hint"> {data.summary.noTrackerCost} more have no cost on the tracker and are not touched.</span>}</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className="dash-filter active" disabled={busy || !data.lines.length} onClick={apply}>{busy ? 'Applying…' : `Apply to ${data.lines.length} lines`}</button>
            <button type="button" className="dash-filter" disabled={busy} onClick={() => setData(null)}>Cancel</button>
          </div>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Unit</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Tracker cost</th></tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}><td>{l.invoice}</td><td>{l.day}</td><td>{l.customer}</td><td>{l.sku}</td>
                <td style={{ textAlign: 'right' }}>{money(l.sold)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: l.trackerCost > l.sold ? 'var(--danger)' : undefined }}>{money(l.trackerCost)}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  );
}
