import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { money, BUSINESS_NAME, BUSINESS_LEGAL, HST_NUMBER } from '../../../../lib/constants';
import { profitAndLoss, PNL_PERIODS } from '../../../../lib/pnl';
import AdminNav from '../../../../components/AdminNav';
import PrintButton from '../../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profit & Loss — Bargain Bay' };

const pct = (v) => `${(Number(v) || 0).toFixed(1)}%`;
// Money that is a cost reads as a negative on a statement — an accountant
// scanning a column shouldn't have to infer the sign from the row label.
const neg = (v) => (v ? `(${money(v)})` : money(0));

function Delta({ now, before }) {
  if (!before) return null;
  const change = ((now - before) / Math.abs(before)) * 100;
  if (!Number.isFinite(change) || Math.abs(change) < 0.05) return null;
  return (
    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}%
    </span>
  );
}

export default async function PnlPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/reports/pnl');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="operations" /><div className="panel">Database not configured.</div></div>);

  const period = PNL_PERIODS.some((p) => p.key === sp?.period) ? sp.period : 'month';
  const pnl = await profitAndLoss(period).catch(() => null);
  if (!pnl) return (<div><AdminNav active="operations" /><div className="error-box">Could not build the statement.</div></div>);

  const c = pnl.current;
  const p = pnl.previous;
  const row = (label, value, before, opts = {}) => (
    <tr key={label} style={opts.strong ? { fontWeight: 700 } : undefined}>
      <td style={{ paddingLeft: opts.indent ? 24 : 0 }}>{label}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {opts.cost ? neg(value) : money(value)}
        {before !== undefined && <Delta now={value} before={before} />}
      </td>
      {opts.note !== undefined && <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12.5 }}>{opts.note}</td>}
    </tr>
  );

  return (
    <div>
      <div className="no-print"><AdminNav active="operations" /></div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <div>
          <h1 style={{ color: 'var(--charcoal)', margin: 0 }}>Profit &amp; Loss</h1>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {BUSINESS_LEGAL} ({BUSINESS_NAME}) · GST/HST # {HST_NUMBER}<br />
            {pnl.label} — {pnl.from} to {pnl.to}
          </p>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {PNL_PERIODS.map((x) => (
            <a key={x.key} href={`/admin/reports/pnl?period=${x.key}`}
              className={'btn' + (x.key === period ? ' accent' : '')} style={{ fontSize: 12.5 }}>{x.label}</a>
          ))}
          <a className="btn" href={`/api/admin/pnl?period=${period}`} style={{ fontSize: 12.5 }}>Download CSV</a>
          <PrintButton label="Print / PDF" />
        </div>
      </div>

      <div className="panel">
        <table className="admin" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>Line</th>
              <th style={{ textAlign: 'right' }}>{pnl.label}</th>
              <th style={{ textAlign: 'right' }}>vs {pnl.prevLabel}</th>
            </tr>
          </thead>
          <tbody>
            {row('Revenue (ex-HST)', c.revenue, p.revenue, { strong: true, note: `${c.orders} order${c.orders === 1 ? '' : 's'}` })}
            {c.discounts > 0 && row('  of which discounted', c.discounts, undefined, { indent: true, note: 'promo codes' })}
            {row('Cost of goods sold', c.cogs, p.cogs, { cost: true, note: c.unitsMissingCost ? `${c.unitsMissingCost} unit(s) with no cost on file` : `${pct(c.costCoveragePct)} of sales costed` })}
            {row('Gross profit', c.grossProfit, p.grossProfit, { strong: true, note: pct(c.grossMarginPct) })}

            <tr><td colSpan={3} style={{ paddingTop: 14, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '.05em' }}>Operating expenses</td></tr>
            {c.byCategory.length === 0 && (
              <tr><td colSpan={3} style={{ paddingLeft: 24, color: 'var(--muted)' }}>Nothing recorded in this period.</td></tr>
            )}
            {c.byCategory.map((x) => row(x.category, x.amount, undefined, {
              indent: true, cost: true,
              note: x.unreviewed ? `${x.unreviewed} row(s) with no HST answered` : ''
            }))}
            {c.ads > 0 && row('Ad spend', c.ads, p.ads, { indent: true, cost: true })}
            {c.labor > 0 && row('Labour', c.labor, p.labor, { indent: true, cost: true })}
            {row('Total operating expenses', c.opex, p.opex, { cost: true, strong: true })}

            <tr><td colSpan={3} style={{ borderTop: '2px solid var(--line)', paddingTop: 4 }} /></tr>
            {row('Net profit', c.netProfit, p.netProfit, { strong: true, note: pct(c.netMarginPct) })}
          </tbody>
        </table>
      </div>

      {/* The two ways this statement can mislead, said out loud rather than left
          for someone to discover after they've acted on it. */}
      {(c.costCoveragePct < 95 || c.unreviewedExpenseRows > 0) && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          <b>Read these caveats before acting on the bottom line.</b>
          {c.costCoveragePct < 95 && (
            <div>
              Only {pct(c.costCoveragePct)} of what was sold has a cost on file, so gross profit is
              flattering by whatever the other {pct(100 - c.costCoveragePct)} actually cost.
              {c.unitsMissingCost > 0 && <> {c.unitsMissingCost} unit(s) are missing one.</>}
            </div>
          )}
          {c.unreviewedExpenseRows > 0 && (
            <div>
              {c.unreviewedExpenseRows} expense row(s) have no HST answered yet, so they&apos;re counted at the full
              amount charged. Answering them under <b>HST to confirm</b> moves the recoverable part out of costs
              and into your input tax credits — expenses here will drop, and so will what you remit.
            </div>
          )}
        </div>
      )}

      <p className="hint" style={{ lineHeight: 1.6 }}>
        Revenue counts on the day the sale was made and expenses on the day they were incurred — the same basis
        as the Sales dashboard, so the two agree. HST is excluded throughout: it is collected for the CRA, not
        earned. Have your accountant check it before it goes anywhere official.
      </p>
    </div>
  );
}
