'use client';
import { useState } from 'react';

const money = (v) => `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const month = (d) => new Date(`${d}-01T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' });

// Sold units whose cost was saved as $0 instead of "use the tracker's cost".
// Preview first (read-only), then apply to exactly the lines the preview showed.
export default function CostFix({ initial }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  async function preview() {
    setBusy(true); setErr(''); setDone(null);
    try {
      const r = await fetch('/api/admin/cost-audit');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setData(d);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function apply() {
    const n = data.invoiceLines.length;
    if (!confirm(`Reset the cost on ${n} invoice lines and ${data.orderLines.count} order lines to the tracker cost?\n\nThis changes profit figures for past months.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/cost-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, invoiceLineIds: data.invoiceLines.map((l) => l.id), orderLineIds: data.orderLines.ids }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setDone(d); setData(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const byMonth = {};
  (data?.invoiceLines || []).forEach((l) => {
    const m = l.day.slice(0, 7); const v = (byMonth[m] ||= { n: 0, sold: 0, cost: 0 });
    v.n += 1; v.sold += l.sold; v.cost += l.trackerCost;
  });
  const below = (data?.invoiceLines || []).filter((l) => l.trackerCost > l.sold);

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Fix $0 costs</h1>
      <p className="hint">
        An empty cost box used to be saved as <b>$0</b>, which beat the tracker&apos;s real cost, so those sales read as
        pure profit. This resets those lines to <b>blank</b>, meaning &ldquo;use the tracker&apos;s cost&rdquo;. It never types in a figure, and it
        only touches lines whose product has a real cost, so genuine haul-aways at $0 are left alone. Nothing changes until you press Apply.
      </p>

      {done ? (
        <div style={{ border: '2px solid var(--ok)', borderRadius: 12, padding: 14 }}>
          <b>Done.</b> Reset {done.invoiceLines} invoice lines and {done.orderLines} order lines.
          {done.skipped > 0 && <> {done.skipped} no longer matched the rule and were left alone.</>}
          {' '}Profit figures now use the tracker costs. <a href="/admin/daily-pnl">Back to the Daily P&amp;L</a>
        </div>
      ) : !data ? (
        <>
          <p style={{ fontSize: 16 }}>
            {initial.summary?.lines
              ? <><b>{initial.summary.lines}</b> invoice lines on {initial.summary.invoices} invoices are costed at $0. The cost left out is <b>{money(initial.summary.costLeftOut)}</b>.</>
              : <>No sold units are costed at $0. Nothing to fix.</>}
          </p>
          <button type="button" className="dash-filter active" disabled={busy} onClick={preview}>{busy ? 'Loading…' : 'Preview the correction'}</button>
        </>
      ) : (
        <>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <b>{data.invoiceLines.length} invoice lines</b> on {data.summary.invoices} invoices, and <b>{data.orderLines.count} order lines</b> on {data.orderLines.orders} orders, will be reset from $0 to the tracker cost.
            <div style={{ marginTop: 6 }}>Sold for {money(data.summary.sales)} before tax. Cost now counted: $0.00. Cost after: <b>{money(data.summary.costLeftOut)}</b>. Profit on these lines falls by the same amount.</div>
            <table className="admin" style={{ marginTop: 10 }}>
              <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Cost added</th></tr></thead>
              <tbody>{Object.entries(byMonth).sort().map(([m, v]) => (
                <tr key={m}><td>{month(m)}</td><td style={{ textAlign: 'right' }}>{v.n}</td><td style={{ textAlign: 'right' }}>{money(v.sold)}</td><td style={{ textAlign: 'right' }}>{money(v.cost)}</td></tr>
              ))}</tbody>
            </table>
            {below.length > 0 && <p style={{ color: 'var(--warn)', marginBottom: 0 }}><b>{below.length} of these sold for less than they cost:</b> {below.map((l) => l.invoice).join(', ')}.</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button type="button" className="dash-filter active" disabled={busy} onClick={apply}>{busy ? 'Applying…' : `Apply correction to ${data.invoiceLines.length} lines`}</button>
            <button type="button" className="dash-filter" disabled={busy} onClick={() => setData(null)}>Cancel</button>
          </div>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Unit</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Cost now</th><th style={{ textAlign: 'right' }}>Cost after</th></tr></thead>
            <tbody>{data.invoiceLines.map((l) => (
              <tr key={l.id}><td>{l.invoice}</td><td>{l.day}</td><td>{l.customer}</td><td>{l.sku}</td>
                <td style={{ textAlign: 'right' }}>{money(l.sold)}</td><td style={{ textAlign: 'right' }}>$0.00</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: l.trackerCost > l.sold ? 'var(--danger)' : undefined }}>{money(l.trackerCost)}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  );
}
