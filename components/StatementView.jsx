// A weekly commission statement, read-only. Used by the rep's Performance page and the owner's screen.
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const STATUS = { draft: 'Draft — not yet approved', approved: 'Approved', paid: 'Paid' };

export default function StatementView({ s }) {
  if (!s) return null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <b>{dayName(s.weekStart)} – {dayName(s.weekEnd)}</b>
        <span className={'pill ' + (s.status === 'draft' ? 'warn' : 'ok')}>{STATUS[s.status] || s.status}</span>
      </div>
      {s.drift ? <p role="alert" style={{ color: 'var(--red, #c33)', fontSize: 13 }}>Since approval the live figures have moved by {money(s.drift)} (a payment was changed). The approved total below is what was signed off.</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table className="admin" style={{ minWidth: 520, marginTop: 8 }}>
          <thead><tr><th>Day</th><th>Type</th><th style={{ textAlign: 'right' }}>Collected (ex HST)</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Commission</th></tr></thead>
          <tbody>
            {s.days.map((d) => (
              <tr key={d.day}>
                <td>{dayName(d.day)}</td><td>{d.mode === 'in-house' ? 'In-house' : 'Mobile'}</td>
                <td style={{ textAlign: 'right' }}>{money(d.net)}</td><td style={{ textAlign: 'right' }}>{d.pct ? `${d.pct}%` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{d.commission ? money(d.commission) : '—'}</td>
              </tr>
            ))}
            {s.adjustments.map((a, i) => (
              <tr key={`a${i}`} style={{ color: 'var(--red, #c33)' }}>
                <td>{dayName(a.at)}</td><td colSpan={3}>Refund on {a.invoice} (it reduced {dayName(a.forDay)})</td>
                <td style={{ textAlign: 'right' }}>{money(a.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} style={{ textAlign: 'right' }}>Commission</td><td style={{ textAlign: 'right' }}>{money(s.commission)}</td></tr>
            <tr><td colSpan={4} style={{ textAlign: 'right' }}>Refund adjustments</td><td style={{ textAlign: 'right' }}>{money(s.adjustmentsTotal)}</td></tr>
            <tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 800 }}>Total this week</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{money(s.total)}</td></tr>
          </tfoot>
        </table>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13.5 }}>What made up each day</summary>
        {s.days.filter((d) => d.rows.length).map((d) => (
          <div key={d.day} style={{ fontSize: 13, padding: '4px 0' }}>
            <b>{dayName(d.day)}</b>
            {d.rows.map((r, i) => <div key={i} className="hint">{r.kind === 'liquidation' ? 'Partner sale' : r.ref} — {r.basis} — {money(r.net)} before HST{r.kind === 'payment' ? ` (paid ${money(r.amount)})` : ''}</div>)}
          </div>
        ))}
      </details>
    </div>
  );
}
