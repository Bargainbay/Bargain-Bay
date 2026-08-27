import { money } from '../lib/constants';
import { Kpi } from './charts';

// What the shop owes the CRA: HST charged on sales, less the input tax credits
// recorded against it. The point of the panel is the year-to-date figure — the
// tax on a sale was never the shop's money, and finding that out in April is how
// a good year turns into a bad quarter.
//
// The honesty problem this has to solve: a credit only exists here if somebody
// recorded one, and spending nobody has reviewed looks exactly like spending
// with no tax on it. So `coverage` is shown as prominently as the total, and
// when it's poor the net figure is labelled a ceiling rather than an answer.
export default function TaxOwed({ data }) {
  if (!data) return null;
  const { current, yearToDate, quarters, coverage, year, periodLabel } = data;
  const credits = yearToDate.credits;
  // Below this, "what you owe" isn't a claim worth making.
  const thin = coverage.pct < 80 || credits.total <= 0;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>HST remittance</h2>
        <span className="hint" style={{ margin: 0 }}>Charged on the sale date, credits on the invoice date — the basis you file on</span>
      </div>

      <div className="dash-kpis" style={{ marginTop: 12 }}>
        <Kpi label={thin ? `Owed on ${year} so far — at most` : `Owed on ${year} so far`}
          value={money(yearToDate.net)}
          sub={`${money(yearToDate.charged)} charged − ${money(credits.total)} credits`} />
        <Kpi label={`Charged · ${periodLabel}`} value={money(current.charged)}
          sub={`on ${money(current.sales)} of sales`} />
        <Kpi label="Collected, not yet remitted" value={money(yearToDate.collected)}
          sub="money in the bank that isn't yours" />
      </div>

      {/* Where the credits came from. A source sitting at zero is the useful
          part of this list — it says which pile of paperwork isn't being kept. */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13.5 }}>
        <span style={{ color: 'var(--muted)' }}>{year} credits:</span>
        <span>Stock invoices <b>{money(credits.stock)}</b></span>
        <span>Expenses <b>{money(credits.expenses)}</b></span>
        <span>Ad spend <b>{money(credits.ads)}</b></span>
      </div>

      {thin && (
        <div className="error-box" style={{ lineHeight: 1.6 }}>
          <b>Treat this as a ceiling, not a filing figure.</b>{' '}
          {credits.total <= 0
            ? 'No input tax credits have been recorded at all, so this is the full amount charged on sales with nothing taken off.'
            : `Only ${coverage.pct}% of this year's recorded spending has had its tax entered${coverage.unreviewedRows ? ` — ${coverage.unreviewedRows} row${coverage.unreviewedRows === 1 ? '' : 's'} still blank` : ''}. Anything unrecorded is a credit you haven't claimed.`}
        </div>
      )}

      {quarters.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="admin">
            <thead>
              <tr>
                <th>{year} quarter</th>
                <th style={{ textAlign: 'right' }}>Sales (ex-HST)</th>
                <th style={{ textAlign: 'right' }}>HST charged</th>
                <th style={{ textAlign: 'right' }}>Credits</th>
                <th style={{ textAlign: 'right' }}>Net owed</th>
                <th style={{ textAlign: 'right' }}>Still to collect</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.quarter}>
                  <td>
                    <b>{q.quarter}</b> <span style={{ color: 'var(--muted)' }}>{q.label}</span>
                    {/* A part-finished quarter read as a finished one is how a
                        remittance comes up short. */}
                    {q.inProgress && <span className="pill" style={{ fontSize: 11, marginLeft: 6 }}>in progress</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(q.sales)}</td>
                  <td style={{ textAlign: 'right' }}>{money(q.charged)}</td>
                  <td style={{ textAlign: 'right' }}>{q.credits.total > 0 ? `−${money(q.credits.total)}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(q.net)}</td>
                  <td style={{ textAlign: 'right' }}>{q.owing > 0 ? money(q.owing) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td><b>{year} to date</b></td>
                <td style={{ textAlign: 'right' }}>{money(yearToDate.sales)}</td>
                <td style={{ textAlign: 'right' }}>{money(yearToDate.charged)}</td>
                <td style={{ textAlign: 'right' }}>{credits.total > 0 ? `−${money(credits.total)}` : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(yearToDate.net)}</td>
                <td style={{ textAlign: 'right' }}>{yearToDate.owing > 0 ? money(yearToDate.owing) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Credits come from the tax on supplier stock invoices (confirmed when you upload one), on operating
        expenses, and on ad spend — anything with no tax entered against it is counted as no credit, not as
        tax-free. Refunds are already netted off, in the month of the original sale. Quarters are calendar
        quarters. Have your accountant check it before you file.
      </p>
    </div>
  );
}
