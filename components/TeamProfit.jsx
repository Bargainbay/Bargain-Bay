// Admin-only: every rep's gross profit today and the commission it comes to.
// Carries profit, so the page only renders it (and the server only computes it)
// for an admin.
const $ = (v) => `$${Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TeamProfit({ data }) {
  if (!data?.team?.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Rep commission · {data.label}</h2>
      <p className="hint" style={{ marginTop: 4 }}>
        {data.rule.pct}% of the day’s gross profit on any day that reaches ${data.rule.threshold.toLocaleString('en-CA')}. Credited to whoever closed the sale. This is what to pay, before the base.
      </p>
      <div className="table-wrap">
        <table className="admin">
          <thead><tr>
            <th>Rep</th><th style={{ textAlign: 'right' }}>Today GP</th><th style={{ textAlign: 'right' }}>Today commission</th>
            <th style={{ textAlign: 'right' }}>Month GP</th><th style={{ textAlign: 'right' }}>Days at target</th><th style={{ textAlign: 'right' }}>Month commission</th>
          </tr></thead>
          <tbody>
            {data.team.map((r) => (
              <tr key={r.key}>
                <td>{r.name}{r.missingCost > 0 && <span className="pill warn" style={{ marginLeft: 6 }} title="Units sold with no cost on file are counted as $0 profit">{r.missingCost} no cost</span>}</td>
                <td style={{ textAlign: 'right' }}>{$(r.today.gp)}</td>
                <td style={{ textAlign: 'right' }}>{$(r.today.commission)}</td>
                <td style={{ textAlign: 'right' }}>{$(r.month.gp)}</td>
                <td style={{ textAlign: 'right' }}>{r.month.daysHit} / {r.month.daysSold}</td>
                <td style={{ textAlign: 'right' }}><b>{$(r.month.commission)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
