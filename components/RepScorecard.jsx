import { money } from '../lib/constants';
import RepsEditor from './RepsEditor';
import QuotaEditor from './QuotaEditor';

// The sales team, four ways: this month against quota, the period scorecard,
// today/week/month side by side, and the people who SEND leads.
//
// Revenue is pre-tax and the rep rows plus "No rep recorded" add up to the
// Revenue KPI above — a scorecard that disagrees with the headline number is
// one nobody trusts. "Own lead" = the sale's sent-by name is the rep.
const R = { textAlign: 'right' };
const pctText = (n) => (n == null ? '—' : `${n.toFixed(0)}%`);
const STATUS = {
  hit: ['ok', 'Hit'], on_pace: ['ok', 'On pace'], close: ['warn', 'Close'], behind: ['sold', 'Behind']
};

function Bar({ s, children }) {
  if (!s) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const [cls, label] = STATUS[s.status] || ['', ''];
  return (
    <div style={{ minWidth: 130 }}>
      <div>{children} <span style={{ color: 'var(--muted)' }}>· {s.pct.toFixed(0)}%</span></div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--line-soft)', margin: '4px 0' }}>
        <div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, s.pct)}%`, background: 'var(--charcoal)' }} />
      </div>
      {label && <span className={'pill ' + cls}>{label}</span>}
    </div>
  );
}

export default function RepScorecard({ data, period, admin }) {
  if (!data) return null;
  const { reps, unassigned, totals, leadGens, windows, quota, unlisted, team } = data;
  const empty = reps.length === 0;
  const q = quota;
  const quotaRows = q.rows;
  const anyQuota = quotaRows.some((r) => r.quota);

  return (
    <>
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Quotas · {q.label}</h2>
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <RepsEditor current={team} />
            {admin && quotaRows.length > 0 && q.ready && <QuotaEditor rows={quotaRows} monthLabel={q.label} />}
          </span>
        </div>
        {empty ? (
          <p className="hint" style={{ marginTop: 10 }}>Add your salespeople with <b>Add salespeople</b>, then every invoice they raise is credited to them automatically.</p>
        ) : !q.ready ? (
          <p className="hint" style={{ marginTop: 10 }}>Quotas aren&apos;t available yet — run the schema migration under <a href="/admin/operations" style={{ textDecoration: 'underline' }}>Operations</a>.</p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 6 }}>
              Day {q.day} of {q.daysInMonth} — <b>{(q.pace * 100).toFixed(0)}%</b> of the month gone, so that&apos;s where each bar should be.
              {!anyQuota && (admin ? ' No quotas set yet — press Set quotas.' : ' No quotas have been set yet.')}
            </p>
            <div className="table-wrap" style={{ marginTop: 10 }}><table className="admin">
              <thead><tr><th>Rep</th><th>Revenue</th><th>Sales</th><th>Own-lead revenue</th><th>Own-lead sales</th></tr></thead>
              <tbody>{quotaRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td>{r.quota?.revenue != null ? <Bar s={r.standing.revenue}>{money(r.actual.revenue)} of {money(r.quota.revenue)}</Bar> : <span>{money(r.actual.revenue)}</span>}</td>
                  <td>{r.quota?.sales != null ? <Bar s={r.standing.sales}>{r.actual.sales} of {r.quota.sales}</Bar> : <span>{r.actual.sales}</span>}</td>
                  <td>{r.quota?.ownRevenue != null ? <Bar s={r.standing.ownRevenue}>{money(r.actual.ownRevenue)} of {money(r.quota.ownRevenue)}</Bar> : <span>{money(r.actual.ownRevenue)}</span>}</td>
                  <td>{r.quota?.ownSales != null ? <Bar s={r.standing.ownSales}>{r.actual.ownSales} of {r.quota.ownSales}</Bar> : <span>{r.actual.ownSales}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
        {unlisted.length > 0 && (
          <p className="hint" style={{ marginTop: 10 }}>
            Sales are credited to {unlisted.map((n) => `“${n}”`).join(', ')}, who {unlisted.length === 1 ? 'isn’t' : 'aren’t'} on the team list spelled that way.
            They still show here; add them under Edit team so the spelling matches.
          </p>
        )}
      </div>

      {!empty && (
        <>
          <div className="panel" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sales by rep · {period}</h2>
            <div className="table-wrap" style={{ marginTop: 8 }}><table className="admin">
              <thead><tr>
                <th>Rep</th><th style={R}>Sales</th><th style={R}>Revenue</th><th style={R}>Avg sale</th>
                <th style={R}>Own-lead sales</th><th style={R}>Own-lead revenue</th><th style={R}>Own-lead %</th>
                <th style={R}>Quotes</th><th style={R}>Win rate</th>
              </tr></thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.key} style={r.sales === 0 ? { color: 'var(--muted)' } : undefined}>
                    <td>{r.name}</td><td style={R}>{r.sales}</td>
                    <td style={{ ...R, fontWeight: 700 }}>{money(r.revenue)}</td>
                    <td style={R}>{r.sales ? money(r.avg) : '—'}</td>
                    <td style={R}>{r.ownSales}</td><td style={R}>{money(r.ownRevenue)}</td><td style={R}>{pctText(r.ownShare)}</td>
                    <td style={R}>{r.quotes.total}</td><td style={R}>{pctText(r.quotes.winRate)}</td>
                  </tr>
                ))}
                <tr style={{ color: 'var(--muted)' }}>
                  <td>No rep recorded</td><td style={R}>{unassigned.sales}</td><td style={R}>{money(unassigned.revenue)}</td>
                  <td style={R}>{unassigned.sales ? money(unassigned.revenue / unassigned.sales) : '—'}</td><td style={R}>—</td><td style={R}>—</td><td style={R}>—</td><td style={R}>—</td><td style={R}>—</td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td><td style={R}>{totals.sales}</td><td style={R}>{money(totals.revenue)}</td>
                  <td style={R}>{totals.sales ? money(totals.revenue / totals.sales) : '—'}</td>
                  <td style={R}>{totals.ownSales}</td><td style={R}>{money(totals.ownRevenue)}</td>
                  <td style={R}>{pctText(totals.revenue ? (totals.ownRevenue / totals.revenue) * 100 : null)}</td><td style={R}></td><td style={R}></td>
                </tr>
              </tbody>
            </table></div>
            <p className="hint" style={{ marginTop: 10 }}>
              Revenue is before HST and adds up to the Revenue figure above. &ldquo;No rep recorded&rdquo; is storefront orders and anything raised before reps were credited.
              Quotes only count where a rep was tagged on the quote.
            </p>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Today · this week · this month</h2>
            <div className="table-wrap" style={{ marginTop: 8 }}><table className="admin">
              <thead><tr><th>Rep</th>
                <th style={R}>Today sales</th><th style={R}>Today revenue</th>
                <th style={R}>Week sales</th><th style={R}>Week revenue</th>
                <th style={R}>Month sales</th><th style={R}>Month revenue</th></tr></thead>
              <tbody>
                {[...windows.reps, { key: '_u', name: 'No rep recorded', ...windows.unassigned, muted: true }].map((r) => (
                  <tr key={r.key} style={r.muted ? { color: 'var(--muted)' } : undefined}>
                    <td>{r.name}</td>
                    <td style={R}>{r.today.sales}</td><td style={R}>{money(r.today.revenue)}</td>
                    <td style={R}>{r.week.sales}</td><td style={R}>{money(r.week.revenue)}</td>
                    <td style={R}>{r.month.sales}</td><td style={{ ...R, fontWeight: 700 }}>{money(r.month.revenue)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}><td>Total</td>
                  <td style={R}>{windows.total.today.sales}</td><td style={R}>{money(windows.total.today.revenue)}</td>
                  <td style={R}>{windows.total.week.sales}</td><td style={R}>{money(windows.total.week.revenue)}</td>
                  <td style={R}>{windows.total.month.sales}</td><td style={R}>{money(windows.total.month.revenue)}</td></tr>
              </tbody>
            </table></div>
          </div>
        </>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Leads sent, by person · {period}</h2>
        {leadGens.length === 0 ? (
          <p className="hint" style={{ marginTop: 8 }}>
            No sales in this period name who sent them. Fill in &ldquo;sent by&rdquo; on the invoice and the person shows up here.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}><table className="admin">
            <thead><tr><th>Sent by</th><th style={R}>Sales</th><th style={R}>Revenue</th><th>Closed by</th></tr></thead>
            <tbody>{leadGens.map((g) => (
              <tr key={g.key}>
                <td>{g.name}{g.isRep && <span style={{ color: 'var(--muted)' }}> (sales rep)</span>}</td>
                <td style={R}>{g.sales}</td><td style={{ ...R, fontWeight: 700 }}>{money(g.revenue)}</td>
                <td style={{ color: 'var(--muted)' }}>{g.closers.map((c) => `${c.name} ${c.sales}`).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          This counts leads that became a sale. A lead that never bought isn&apos;t recorded anywhere yet, so it can&apos;t be counted here.
        </p>
      </div>
    </>
  );
}
