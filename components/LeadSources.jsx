import { money } from '../lib/constants';

// "Where did the business come from this month" — the sales dashboard's own
// panel, sitting under the per-salesperson table because it answers the
// neighbouring question: that one is who CLOSED it, this one is who SENT it.
//
// Two tables, because they are two different questions and only one of them has
// a fixed set of answers. By source is the shape of the funnel — walk-ins vs the
// website vs Kijiji — and every source is listed even at zero, because "no
// walk-ins this week" is a real answer and an absent row is not. Who sent it is
// a list of people, and it only exists once somebody types a name.
//
// COVERAGE IS STATED FIRST AND IN WORDS. The tables are only worth reading in
// proportion to how much of the period was actually answered for, and on the day
// this ships that is zero — every sale predating it has no source. A panel that
// showed the marked sales alone would read as a complete picture of the month
// from its first hour.
const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

export default function LeadSources({ data, period }) {
  if (!data) {
    return (
      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Where the sales came from</h2>
        <p className="hint" style={{ marginTop: 8 }}>
          Not available yet — run the schema migration under{' '}
          <a href="/admin/operations" style={{ textDecoration: 'underline' }}>Operations</a>, then record a
          source on the next invoice you raise.
        </p>
      </div>
    );
  }

  const { bySource, bySender, totals, allSources } = data;
  // Every source, in the order the list defines them, with the sales that named
  // each — then anything recorded under a name we no longer have a label for,
  // and finally the sales nobody answered for.
  const found = new Map(bySource.filter((r) => r.known).map((r) => [r.key, r]));
  const rows = allSources.map((sdef) => found.get(sdef.key) || { key: sdef.key, label: sdef.label, orders: 0, revenue: 0 });
  for (const r of bySource) if (r.known && !allSources.some((sdef) => sdef.key === r.key)) rows.push(r);
  const ranked = rows.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  const unrecorded = totals.unrecordedOrders;

  // Two FULL-WIDTH panels rather than a dash-2col pair. table.admin carries
  // min-width: 760px, so in a half-width column the Revenue and Share columns
  // fall off the end of the table's own scroll box — measured at 1400px, where
  // each half is 607px of a 760px table. These are the numbers the panel exists
  // to show; making the owner drag a table sideways to see them is not a layout.
  return (
    <>
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Where the sales came from · {period}</h2>
        </div>
        {totals.orders === 0 ? (
          <p className="hint" style={{ marginTop: 10 }}>No sales in this period.</p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 6 }}>
              {unrecorded === 0
                ? <>All {totals.orders} sale{totals.orders === 1 ? '' : 's'} say where they came from.</>
                : <><b>{unrecorded} of {totals.orders}</b> sale{totals.orders === 1 ? '' : 's'} ({money(totals.unrecordedRevenue)})
                    have no source on them, so read the split below as {totals.coverage.toFixed(0)}% of the period,
                    not all of it. Anything raised before this was added is blank — add it on the
                    invoice and it lands here.</>}
            </p>
            <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
              <thead><tr><th>Source</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.key} style={r.orders === 0 ? { color: 'var(--muted)' } : undefined}>
                    <td>{r.label}</td>
                    <td style={{ textAlign: 'right' }}>{r.orders}</td>
                    <td style={{ textAlign: 'right', fontWeight: r.orders ? 700 : 400 }}>{money(r.revenue)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{pct(r.revenue, totals.revenue).toFixed(0)}%</td>
                  </tr>
                ))}
                {unrecorded > 0 && (
                  <tr>
                    <td style={{ color: 'var(--muted)' }}>Not recorded</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{unrecorded}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(totals.unrecordedRevenue)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{pct(totals.unrecordedRevenue, totals.revenue).toFixed(0)}%</td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </>
        )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Who sent the lead · {period}</h2>
        {bySender.length === 0 ? (
          <p className="hint" style={{ marginTop: 10 }}>
            Nobody named yet. Put a name in <b>Sent by</b> when you raise the invoice — a referral or a
            contractor lead asks for one — and whoever is sending you business shows up here with what
            it was worth.
          </p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 6 }}>
              Sales credited to a person who sent them. This is the list to read before paying a referral
              or ringing round the people who keep sending work.
            </p>
            <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
              <thead><tr><th>Sent by</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>
                {bySender.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}
                      {r.sources.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.sources.join(' · ')}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.orders}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </div>
    </>
  );
}
