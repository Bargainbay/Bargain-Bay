'use client';
import { useEffect, useState } from 'react';

// Won, lost, and why — the question a quote list exists to answer and could not.
//
// UNRECORDED IS A ROW, NOT A GAP. The same rule the lead-source panel follows:
// on the day this ships every lost quote is unrecorded, and a report showing
// only the answered ones would read as a complete picture of the year from its
// first hour.
const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuoteOutcomes() {
  const [o, setO] = useState(null);
  useEffect(() => {
    fetch('/api/admin/quotes?view=outcomes').then((r) => r.json())
      .then((d) => setO(d.outcomes || null)).catch(() => setO(null));
  }, []);
  if (!o) return null;

  const closed = o.won + o.lost;
  const rows = [...o.reasons].sort((a, b) => b.n - a.n).filter((r) => r.n > 0 || o.lost === 0);

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Won &amp; lost <span className="hint" style={{ fontWeight: 400, fontSize: 13 }}>· last 12 months</span></h2>

      <div className="dash-kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="kpi-label">Won</div>
          <div className="kpi-value">{o.won}</div><div className="kpi-sub">{money(o.wonValue)}</div></div>
        <div className="kpi"><div className="kpi-label">Lost</div>
          <div className="kpi-value">{o.lost}</div><div className="kpi-sub">{money(o.lostValue)}</div></div>
        <div className="kpi"><div className="kpi-label">Win rate</div>
          <div className="kpi-value">{o.winRate == null ? '—' : `${Math.round(o.winRate * 100)}%`}</div>
          <div className="kpi-sub">{closed ? `of ${closed} closed` : 'nothing closed yet'}</div></div>
        <div className="kpi"><div className="kpi-label">Still live</div>
          <div className="kpi-value">{o.live}</div><div className="kpi-sub">{money(o.liveValue)}</div></div>
      </div>

      {o.lost > 0 && (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Why it was lost</th><th style={{ textAlign: 'right' }}>Quotes</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
          <tbody>
            {/* Leading with what nobody answered for, because on day one that
                is everything and a report that hid it would mislead. */}
            {o.unrecorded > 0 && (
              <tr style={{ background: '#fdf8e7' }}>
                <td><b>Not recorded</b> <span className="hint" style={{ fontSize: 12 }}>— pick a reason on the quote</span></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{o.unrecorded}</td>
                <td style={{ textAlign: 'right' }}>{money(o.unrecordedValue)}</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td style={{ textAlign: 'right' }}>{r.n}</td>
                <td style={{ textAlign: 'right' }}>{money(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
