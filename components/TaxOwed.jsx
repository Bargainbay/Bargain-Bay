import { money } from '../lib/constants';
import { Kpi } from './charts';

// What the shop owes the CRA off its own sales, and how much of it it's actually
// holding yet. The point of the panel is the year-to-date figure: the tax on a
// sale was never the shop's money, and finding that out in April is how a good
// year turns into a bad quarter.
//
// It reports HST CHARGED, and says so plainly. The amount actually remitted is
// this less input tax credits — the HST paid out on stock and on expenses —
// which nothing in this system captures. Naming a number the owner might file
// would be worse than naming half of one and saying which half.
export default function TaxOwed({ data }) {
  if (!data) return null;
  const { current, yearToDate, quarters, year, periodLabel } = data;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>HST on sales</h2>
        <span className="hint" style={{ margin: 0 }}>Charged on the sale date — the basis you file on</span>
      </div>

      <div className="dash-kpis" style={{ marginTop: 12 }}>
        <Kpi label={`HST charged on ${year} sales`} value={money(yearToDate.charged)}
          sub={yearToDate.owing > 0
            ? `${money(yearToDate.collected)} in hand · ${money(yearToDate.owing)} not collected yet`
            : 'all of it collected'} />
        <Kpi label={`Charged · ${periodLabel}`} value={money(current.charged)}
          sub={`on ${money(current.sales)} of sales`} />
        <Kpi label="Collected, not yet remitted" value={money(yearToDate.collected)}
          sub="money in the bank that isn't yours" />
      </div>

      {quarters.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="admin">
            <thead>
              <tr>
                <th>{year} quarter</th>
                <th style={{ textAlign: 'right' }}>Sales (ex-HST)</th>
                <th style={{ textAlign: 'right' }}>HST charged</th>
                <th style={{ textAlign: 'right' }}>Collected</th>
                <th style={{ textAlign: 'right' }}>Still to come in</th>
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
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(q.charged)}</td>
                  <td style={{ textAlign: 'right' }}>{money(q.collected)}</td>
                  <td style={{ textAlign: 'right' }}>{q.owing > 0 ? money(q.owing) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td><b>{year} to date</b></td>
                <td style={{ textAlign: 'right' }}>{money(yearToDate.sales)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(yearToDate.charged)}</td>
                <td style={{ textAlign: 'right' }}>{money(yearToDate.collected)}</td>
                <td style={{ textAlign: 'right' }}>{yearToDate.owing > 0 ? money(yearToDate.owing) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12, lineHeight: 1.6 }}>
        <b>This is HST charged on sales, not the cheque you write.</b> What you remit is this figure less your
        input tax credits — the HST you paid on stock, fuel, rent and everything else — and none of that is
        recorded here yet. Take this to your accountant as the sales side of the return.
        <br />
        Refunds are already netted off, in the month of the original sale. Quarters are calendar quarters;
        tell me if your fiscal year ends anywhere other than December.
      </p>
    </div>
  );
}
