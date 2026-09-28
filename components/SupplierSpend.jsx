'use client';
import { useEffect, useState } from 'react';

// What we have spent with each supplier, period by period.
//
// This question — "what did we spend with SecondShop in August against
// September" — had no answer anywhere. Nothing grouped purchase invoices by
// period, so the only supplier figure in the building was one twelve-month
// ordered total, and that is what we agreed to buy rather than what we paid.
const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const exact = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const label = (iso, unit) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return unit === 'week'
    ? d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-CA', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

export default function SupplierSpend() {
  const [unit, setUnit] = useState('month');
  const [periods, setPeriods] = useState(6);
  const [d, setD] = useState(null);

  useEffect(() => {
    setD(null);
    fetch(`/api/admin/suppliers?view=spend&groupBy=${unit}&periods=${periods}`, { cache: 'no-store' })
      .then((r) => r.json()).then(setD).catch(() => setD({ suppliers: [], periods: [], total: 0 }));
  }, [unit, periods]);

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>What we spend</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {['month', 'week'].map((u) => (
            <button key={u} className={'btn' + (unit === u ? ' primary' : '')}
                    style={{ fontSize: 12.5 }} onClick={() => { setUnit(u); setPeriods(u === 'week' ? 8 : 6); }}>
              by {u}
            </button>
          ))}
          <select value={periods} style={{ fontSize: 12.5 }} onChange={(e) => setPeriods(Number(e.target.value))}>
            {[3, 6, 12, 18, 24].map((n) => <option key={n} value={n}>last {n}</option>)}
          </select>
        </div>
      </div>
      <p className="hint" style={{ margin: '4px 0 10px', fontSize: 12.5 }}>
        <b>Pre-tax, from purchase invoices</b> — what we were actually charged, not what we ordered.
        The HST on top is reclaimed as an input tax credit rather than spent, so counting it would
        overstate every supplier by 13%. Dated to the invoice, so a correction lands in the month of
        the purchase.
      </p>

      {!d && <p className="hint" style={{ margin: 0 }}>Loading…</p>}

      {d && !d.suppliers.length && (
        <p className="hint" style={{ margin: 0 }}>
          No purchase invoices in this window. Spend appears here as supplier invoices are uploaded
          at intake.
        </p>
      )}

      {d && d.suppliers.length > 0 && (
        <>
          <div className="table-wrap"><table className="admin">
            <thead><tr>
              <th>Supplier</th>
              {d.periods.map((p) => <th key={p} style={{ textAlign: 'right' }}>{label(p, d.unit)}</th>)}
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Invoices</th>
            </tr></thead>
            <tbody>
              {d.suppliers.map((s) => (
                <tr key={s.supplier}>
                  <td>
                    {s.supplier}
                    {/* Still spend. Dropping these would understate the total by
                        however much of the unknown-names list is outstanding. */}
                    {s.unidentified && (
                      <div className="hint" style={{ fontSize: 12, color: '#b3261e' }}>not identified yet</div>
                    )}
                  </td>
                  {d.periods.map((p) => (
                    <td key={p} style={{ textAlign: 'right', color: s.byPeriod[p] ? undefined : 'var(--muted)' }}>
                      {s.byPeriod[p] ? money(s.byPeriod[p]) : '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}><b>{exact(s.total)}</b></td>
                  <td style={{ textAlign: 'right' }} className="hint">{s.invoices}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--line)' }}>
                <td><b>All suppliers</b></td>
                {/* Every period in the window, even the empty ones: a quiet month
                    is a real answer and a missing column reads as missing data. */}
                {d.periods.map((p) => (
                  <td key={p} style={{ textAlign: 'right' }}><b>{d.perPeriod[p] ? money(d.perPeriod[p]) : '—'}</b></td>
                ))}
                <td style={{ textAlign: 'right' }}><b>{exact(d.total)}</b></td>
                <td />
              </tr>
            </tbody>
          </table></div>

          {d.unidentified > 0 && (
            <p className="hint" style={{ marginTop: 8, fontSize: 12.5 }}>
              <b>{exact(d.unidentified)}</b> of this is filed under a name nobody has identified, so it
              has no terms, no contact and no on-time record. Answering those below attaches their
              history too.
            </p>
          )}
        </>
      )}
    </div>
  );
}
