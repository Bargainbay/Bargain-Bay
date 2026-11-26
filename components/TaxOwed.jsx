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
const right = { textAlign: 'right' };

// Quarters and months are the same columns over different spans, closed by the same year-to-date line.
function PeriodTable({ head, year, rows, yearToDate }) {
  const credit = (v) => (v > 0 ? `−${money(v)}` : '—');
  const line = (r, strong) => (
    <>
      <td style={right}>{money(r.sales)}</td>
      <td style={right}>{money(r.charged)}</td>
      <td style={right}>{credit(r.credits.total)}</td>
      <td style={{ ...right, fontWeight: strong }}>{money(r.net)}</td>
      <td style={right}>{r.owing > 0 ? money(r.owing) : '—'}</td>
    </>
  );
  return (
    <div className="table-wrap" style={{ marginTop: 14 }}>
      <table className="admin">
        <thead>
          <tr>
            <th>{head}</th>
            <th style={right}>Sales (ex-HST)</th>
            <th style={right}>HST charged</th>
            <th style={right}>Credits</th>
            <th style={right}>Net owed</th>
            <th style={right}>Still to collect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <b>{r.name}</b>{r.span ? <span style={{ color: 'var(--muted)' }}> {r.span}</span> : null}
                {/* A part-finished period read as a finished one is how a remittance comes up short. */}
                {r.inProgress && <span className="pill" style={{ fontSize: 11, marginLeft: 6 }}>in progress</span>}
              </td>
              {line(r, 600)}
            </tr>
          ))}
          <tr>
            <td><b>{year} to date</b></td>
            {line(yearToDate, 700)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function TaxOwed({ data }) {
  if (!data) return null;
  const { current, yearToDate, quarters, months, coverage, year, periodLabel } = data;
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
        <PeriodTable head={`${year} quarter`} year={year} yearToDate={yearToDate}
          rows={quarters.map((q) => ({ ...q, key: q.quarter, name: q.quarter, span: q.label }))} />
      )}
      {months?.length > 0 && (
        <PeriodTable head={`${year} month`} year={year} yearToDate={yearToDate}
          rows={months.map((m) => ({ ...m, key: m.month, name: m.label }))} />
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
