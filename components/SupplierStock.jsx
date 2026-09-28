'use client';
import { useCallback, useEffect, useState } from 'react';

// The stock a vendor has left with us, and clearing the consignment floor.
//
// This was the "By vendor" tab on /admin/warehouse, which put it on a different
// page from the supplier record on Operations — two pages for one subject, and
// nothing linking them. It reads from the TRACKER rather than `products`,
// because the units a vendor rings up about are exactly the ones that are not
// listed: untested, in cleaning, waiting for a part.
const BUCKETS = [
  ['live', 'On sale'],
  ['working', 'Cleaning / QA'],
  ['unpriced', 'No price yet'],
  ['notReady', 'Untested / repair'],
  ['salvage', 'Salvage']
];
const cash = (n) => `$${(Number(n) || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

async function get(params) {
  const res = await fetch(`/api/admin/warehouse?${new URLSearchParams(params)}`, { cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Something went wrong (${res.status}).`);
  return d;
}

// Setting Retail on a unit the tracker prices under the consignment floor.
//
// It is prefilled with the LOWEST figure that clears the floor and says so,
// because "this is under cost + 20%" is not an instruction — the number you
// have to type is. Anything at or above it is accepted: the floor is a minimum,
// not a price.
function FixRetail({ unit, onDone }) {
  const [v, setV] = useState(String(unit.minRetail || ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const low = unit.minRetail && Number(v) > 0 && Number(v) < unit.minRetail;

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/warehouse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_retail', sku: unit.sku, retail: Number(v) })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'That did not work.');
      await onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
      <input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} disabled={busy}
             aria-label={`Retail for ${unit.sku}`}
             style={{ width: 82, textAlign: 'right', padding: '3px 6px', fontSize: 12 }} />
      <button type="button" className="btn" style={{ fontSize: 11 }} disabled={busy || !(Number(v) > 0)}
              onClick={save}>{busy ? '…' : 'set retail'}</button>
      {unit.minRetail
        ? <span className="hint" style={{ margin: 0, fontSize: 11 }}>needs {cash(unit.minRetail)}+</span>
        : <span className="hint" style={{ margin: 0, fontSize: 11 }}>no grade yet</span>}
      {low && <span style={{ fontSize: 11, color: 'var(--danger, #b00)' }}>still under</span>}
      {err && <span style={{ fontSize: 11, color: 'var(--danger, #b00)' }}>{err}</span>}
    </span>
  );
}

export default function SupplierStock({ admin, onOpenUnit }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');

  // Named, because setting a Retail has to re-read the tracker — the Suggested
  // Price it drives is a FORMULA, so what the floor check sees only changes
  // once the sheet has recalculated and been read back.
  const reload = useCallback(async () => {
    try { setD(await get({ view: 'vendors' })); setErr(''); }
    catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => {
    let current = true;
    (async () => {
      try { const r = await get({ view: 'vendors' }); if (current) { setD(r); setErr(''); } }
      catch (e) { if (current) setErr(e.message); }
    })();
    return () => { current = false; };
  }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!d) return <p className="hint">Reading the tracker…</p>;
  if (!d.vendors.length) return <p className="hint">No stock on the tracker.</p>;

  const v = d.vendors.find((x) => x.key === open);
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Everything on the tracker that isn&apos;t sold, by who it came from — {d.totals.onHand} units from {d.totals.vendors} vendors
        {d.totals.consigned > 0 && <>, {d.totals.consigned} of them dropped off (we pay when they sell)</>}.
        Tap a vendor for the units.
        {d.totals.belowFloor > 0 && (
          <b style={{ display: 'block', color: 'var(--danger, #b00)', marginTop: 4 }}>
            {d.totals.belowFloor} dropped-off unit{d.totals.belowFloor === 1 ? ' is' : 's are'} priced under cost + 20% on the tracker.
            Open the vendor below and set the Retail — each one says the lowest figure that clears the floor.
          </b>
        )}
      </p>
      <div className="table-wrap">
        <table className="admin">
          <thead>
            <tr>
              <th>Vendor</th><th style={{ textAlign: 'right' }}>On hand</th>
              {BUCKETS.map(([k, label]) => <th key={k} style={{ textAlign: 'right' }}>{label}</th>)}
              <th style={{ textAlign: 'right' }}>Retail</th>
              {admin && <th style={{ textAlign: 'right' }}>Cost</th>}
              <th style={{ textAlign: 'right' }}>Sold</th>
            </tr>
          </thead>
          <tbody>
            {d.vendors.map((row) => (
              <tr key={row.key} style={{ cursor: 'pointer', background: row.key === open ? 'var(--line-soft, #f4f4f4)' : undefined }}
                onClick={() => setOpen(row.key === open ? '' : row.key)}>
                <td>
                  <b>{row.name}</b>
                  {row.consigned > 0 && <span className="pill" style={{ marginLeft: 6 }}>{row.consigned} dropped off</span>}
                  {row.belowFloor > 0 && <span className="pill" style={{ marginLeft: 6, background: 'var(--danger, #b00)', color: '#fff' }}>{row.belowFloor} under the floor</span>}
                </td>
                <td style={{ textAlign: 'right' }}>{row.onHand}</td>
                {BUCKETS.map(([k]) => <td key={k} style={{ textAlign: 'right', color: row.counts[k] ? 'inherit' : 'var(--muted)' }}>{row.counts[k] || '—'}</td>)}
                <td style={{ textAlign: 'right' }}>{cash(row.retail)}</td>
                {admin && <td style={{ textAlign: 'right' }}>{cash(row.cost)}{row.costMissing > 0 && <span className="hint" style={{ display: 'block', margin: 0 }}>{row.costMissing} with no cost</span>}</td>}
                <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{row.sold || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {v && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{v.name} — {v.onHand} unit{v.onHand === 1 ? '' : 's'} here</h2>
            <button type="button" className="btn" onClick={() => setOpen('')}>Close</button>
          </div>
          {v.oldest && <p className="hint" style={{ marginTop: 4 }}>Oldest arrived {v.oldest}.</p>}
          <div className="table-wrap">
            <table className="admin">
              <thead>
                <tr><th>Unit</th><th>Status</th><th>Spot</th><th>Received</th>
                  <th style={{ textAlign: 'right' }}>Retail</th>{admin && <th style={{ textAlign: 'right' }}>Cost</th>}</tr>
              </thead>
              <tbody>
                {v.units.map((u) => (
                  <tr key={u.sku}>
                    <td>
                      <button type="button" className="linkish" style={{ background: 'none', border: 0, padding: 0, color: 'var(--link, #0a58ca)', cursor: 'pointer', fontFamily: 'monospace' }}
                        onClick={() => onOpenUnit(u.sku)}>{u.sku}</button>
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>
                        {[u.make, u.model].filter(Boolean).join(' ')}{u.consigned ? ' · dropped off' : ''}
                      </span>
                    </td>
                    <td>{u.status}</td>
                    <td>{u.location || <span className="hint" style={{ margin: 0 }}>not placed</span>}</td>
                    <td>{u.dateReceived || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {u.retail ? cash(u.retail) : '—'}
                      {u.belowFloor && (
                        <>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--danger, #b00)' }}>sells at {cash(u.price)} · floor {cash(u.floor)}</span>
                          {/* The warning used to end here, telling somebody to go
                              and open the spreadsheet. Retail is writable from the
                              row now — and RETAIL only: the Condition is RS Ops's
                              grade, and re-grading a machine so its price clears a
                              floor is falsifying the grade to fix the arithmetic. */}
                          {admin && <FixRetail unit={u} onDone={reload} />}
                        </>
                      )}
                    </td>
                    {admin && <td style={{ textAlign: 'right' }}>{u.cost ? cash(u.cost) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
