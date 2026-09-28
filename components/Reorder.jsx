'use client';
import { useCallback, useEffect, useState } from 'react';

// What to buy, and what the shelf cannot tell you.
//
// The order of this screen is the order of the questions. What is short and
// nobody has ordered leads, because it is the only part anybody has to act on
// today. What is short and IS on order comes next, because "did somebody order
// it" is the first thing asked about a part that is out. Then the parts being
// watched, then — never hidden, and on the day this ships it is all of them —
// the parts nobody has set a level for.
const fmtRate = (n) => (n === null || n === undefined ? '—'
  : n >= 1 ? `${Math.round(n * 10) / 10}/day` : `${Math.round(n * 70) / 10}/week`);

async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch { throw new Error('No connection — try again.'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Something went wrong (${res.status}).`);
  return d;
}
const post = (body) => call('/api/admin/parts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

// The editor is the same control wherever a level is set, so the rules read the
// same way in both places.
function LevelEditor({ row, suppliers, onSaved }) {
  const [point, setPoint] = useState(row.reorderPoint ?? '');
  const [qty, setQty] = useState(row.reorderQty ?? '');
  const [sup, setSup] = useState(row.supplierId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = String(point) !== String(row.reorderPoint ?? '')
    || String(qty) !== String(row.reorderQty ?? '')
    || String(sup) !== String(row.supplierId ?? '');

  async function save() {
    setBusy(true); setErr('');
    try {
      await post({
        action: 'reorder', partId: row.id,
        point: point === '' ? null : point,
        qty: qty === '' ? null : qty,
        supplierId: sup === '' ? null : sup
      });
      await onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      <input type="number" min={0} value={point} placeholder="—" title="Buy more when this many are left"
             style={{ width: 58, textAlign: 'right' }} onChange={(e) => setPoint(e.target.value)} />
      <input type="number" min={1} value={qty} placeholder="auto" title="How many to buy — blank refills to twice the level"
             style={{ width: 58, textAlign: 'right' }} onChange={(e) => setQty(e.target.value)} />
      <select value={sup} title="Who we buy it from" style={{ maxWidth: 130 }}
              onChange={(e) => setSup(e.target.value)}>
        <option value="">supplier…</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {dirty && <button className="btn" style={{ fontSize: 11 }} disabled={busy} onClick={save}>save</button>}
      {err && <span style={{ color: '#b3261e', fontSize: 11.5 }}>{err}</span>}
    </span>
  );
}

function BuyTable({ rows, suppliers, onSaved, onOpen, showOrdered }) {
  return (
    <div className="table-wrap"><table className="admin">
      <thead><tr>
        <th>Part</th>
        <th style={{ textAlign: 'right' }}>Available</th>
        <th style={{ textAlign: 'right' }}>Level</th>
        {showOrdered && <th style={{ textAlign: 'right' }}>On order</th>}
        {!showOrdered && <th style={{ textAlign: 'right' }}>Buy</th>}
        <th>Supplier</th>
        <th style={{ textAlign: 'right' }}>Used</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={showOrdered ? undefined : { background: '#fdf3f2' }}>
            <td>
              <button type="button" className="linkish" onClick={() => onOpen?.(r.id)}>{r.name}</button>
              <div className="hint" style={{ fontSize: 12 }}>
                {[r.partNumber, r.brand].filter(Boolean).join(' · ')}
                {r.spots ? ` · ${r.spots}` : ''}
              </div>
            </td>
            <td style={{ textAlign: 'right' }}>
              <b>{r.available}</b>
              {/* Why available is not on-hand. A piece somebody has already been
                  promised is not one you have. */}
              {r.held > 0 && <div className="hint" style={{ fontSize: 12 }}>{r.onHand} on the shelf, {r.held} promised</div>}
            </td>
            <td style={{ textAlign: 'right' }}>{r.reorderPoint}</td>
            {showOrdered && <td style={{ textAlign: 'right' }}>{r.onOrder}</td>}
            {!showOrdered && <td style={{ textAlign: 'right' }}><b>{r.orderQty}</b></td>}
            <td className="hint" style={{ fontSize: 12.5 }}>
              {r.supplier || <span style={{ color: '#b3261e' }}>nobody set</span>}
              {r.supplierContact ? <div>{r.supplierContact}</div> : null}
              {r.leadDays !== null && <div>usually {r.leadDays} days</div>}
            </td>
            <td style={{ textAlign: 'right' }} className="hint">
              {fmtRate(r.usedPerDay)}
              {r.daysOfCover !== null && <div style={{ fontSize: 12 }}>{r.daysOfCover}d left</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

export default function Reorder({ onOpen }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await call('/api/admin/parts?view=reorder', { cache: 'no-store' }));
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="error-box">{err}</div>;
  if (!d) return null;
  const c = d.counts;

  return (
    <div>
      <div className="pt-kpis" style={{ marginBottom: 12 }}>
        <div className="pt-kpi"><b style={{ color: c.toBuy ? '#b3261e' : undefined }}>{c.toBuy}</b><span>to buy</span></div>
        <div className="pt-kpi"><b>{d.onOrder.length}</b><span>short, already ordered</span></div>
        <div className="pt-kpi"><b>{c.soon}</b><span>will run out before it arrives</span></div>
        <div className="pt-kpi"><b>{c.unwatched}</b><span>no level set</span></div>
      </div>

      {!c.toBuy && !d.onOrder.length && (
        <p className="hint" style={{ marginTop: 0 }}>
          Nothing is below its level.{c.watched ? ` ${c.watched} part(s) are being watched.` : ''}
        </p>
      )}

      {d.below.length > 0 && <>
        <h3 style={{ fontSize: 13.5, margin: '0 0 4px', color: '#b3261e' }}>Buy these ({d.below.length})</h3>
        <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
          At or below their level with nothing on the way. <b>Available</b>, not what is on the shelf —
          a piece already promised to a tech is not one you have.
        </p>
        <BuyTable rows={d.below} suppliers={d.suppliers} onSaved={load} onOpen={onOpen} />
      </>}

      {d.onOrder.length > 0 && <>
        <h3 style={{ fontSize: 13.5, margin: '16px 0 4px' }}>Short, but on order ({d.onOrder.length})</h3>
        <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
          Still below the level, and a purchase order already covers it — so it is off the buy list
          without pretending the part is in stock.
        </p>
        <BuyTable rows={d.onOrder} suppliers={d.suppliers} onSaved={load} onOpen={onOpen} showOrdered />
      </>}

      <h3 style={{ fontSize: 13.5, margin: '18px 0 4px' }}>
        Levels ({c.watched} watched{c.unwatched ? `, ${c.unwatched} with none set` : ''})
      </h3>
      <p className="hint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        <b>Blank is not zero.</b> A part with no level is simply not watched — it will never appear on
        the buy list however empty the shelf gets. The second box is how many to buy; left blank it
        refills to twice the level, because refilling only to the level puts it straight back here.
        Usage is measured over the last {d.windowDays} days.
      </p>
      <div className="table-wrap"><table className="admin">
        <thead><tr>
          <th>Part</th><th style={{ textAlign: 'right' }}>Available</th>
          <th style={{ textAlign: 'right' }}>Used</th><th>Suggested</th>
          <th>Level · buy · supplier</th>
        </tr></thead>
        <tbody>
          {[...d.watched, ...(showAll ? d.unwatched : [])].map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="linkish" onClick={() => onOpen?.(r.id)}>{r.name}</button>
                <div className="hint" style={{ fontSize: 12 }}>{[r.partNumber, r.brand].filter(Boolean).join(' · ')}</div>
              </td>
              <td style={{ textAlign: 'right' }}>{r.available}</td>
              <td style={{ textAlign: 'right' }} className="hint">{fmtRate(r.usedPerDay)}</td>
              <td className="hint" style={{ fontSize: 12.5 }}>
                {/* Only where BOTH halves were measured — a rate off real takes
                    and a lead time off real deliveries. Anything else would be a
                    guess wearing arithmetic. */}
                {r.suggestedPoint !== null
                  ? <b>{r.suggestedPoint}</b>
                  : (r.usedPerDay === null ? 'never used one' : 'no delivery timed yet')}
              </td>
              <td><LevelEditor row={r} suppliers={d.suppliers} onSaved={load} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {c.unwatched > 0 && (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : `Show the ${c.unwatched} part(s) with no level set`}
        </button>
      )}
    </div>
  );
}
