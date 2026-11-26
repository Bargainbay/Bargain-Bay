// The owner's view: ten sections under the Financial health cards. A server component: it loads its own figures so
// the rest of the page is not held up while the tracker is read.
import { money } from '../lib/constants';
import { financeInsights } from '../lib/finance-insights';
import OpsSection from './OpsSection';
import CashForecast from './CashForecast';
import FinanceTargets from './FinanceTargets';
import { TrendChart } from './charts';

const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const red = { color: 'var(--danger, #ff6b6b)' };
const $ = (v) => (v == null ? '—' : money(v));
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(0)}%`);
const days = (v) => (v == null ? '—' : `${v} days`);
const day = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const monthName = (k) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function Table({ cols, rows, empty = 'Nothing to show yet.' }) {
  if (!rows.length) return <p className="hint" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
      <table className="admin" style={{ minWidth: 0 }}>
        <thead><tr>{cols.map((c) => <th key={c.h} style={c.r ? right : null}>{c.h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.h} style={c.r ? { ...right, ...(c.neg && c.neg(r) ? red : {}) } : null}>{c.f(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Stats({ items }) {
  return (
    <div className="dash-kpis">
      {items.map((s) => (
        <div className="kpi-card" key={s.label}>
          <div className="kpi-value" style={s.bad ? red : null}>{s.value}</div>
          <div className="kpi-label">{s.label}</div>
          {s.sub ? <div className="kpi-sub">{s.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
function Section({ id, title, open = false, bad, children }) {
  return (
    <OpsSection scope="fin" id={`own-${id}`} title={title} defaultOpen={open}>
      <div className="panel" style={{ marginTop: 18 }}>
        {bad ? <p className="hint" style={{ margin: 0 }}>This could not be loaded just now, so no figure is shown. Reload the page to try again.</p> : children}
      </div>
    </OpsSection>
  );
}
const broken = (x) => !x || x.error;
const line = (label, value, strong) => ({ label, value, strong });

function Returns({ title, rows }) {
  return (<>
    <h3 style={{ margin: '14px 0 6px' }}>{title}</h3>
    <Table rows={rows.filter((g) => g.sold > 0).slice(0, 25)} cols={[
      { h: 'Name', f: (g) => g.name },
      { h: 'Sold', r: true, f: (g) => `${g.sold} of ${g.units}` },
      { h: 'Profit so far', r: true, f: (g) => $(g.profit), neg: (g) => g.profit < 0 },
      { h: 'Return on cost', r: true, f: (g) => pct(g.returnPct), neg: (g) => g.returnPct < 0 },
      { h: 'Days to sell', r: true, f: (g) => (g.avgDays == null ? '—' : g.avgDays) },
      { h: 'Still in stock, at cost', r: true, f: (g) => $(g.stockCost) }
    ]} />
  </>);
}

export default async function FinInsights({ period, periodLabel, bankroll, admin }) {
  const d = await financeInsights({ period, bankroll }).catch((e) => { console.error('finance insights failed', e?.message || e); return null; });
  if (!d) return <div className="error-box" style={{ marginTop: 18 }}>The owner view could not load. The figures above are unaffected.</div>;
  const { profit: p, forecast: f, worth: w, history, trend, goals, even, stock: s, cycle: c, ads } = d;
  const trendRows = broken(trend) ? [] : trend.rows;
  const old = broken(s) ? null : s.ages.find((a) => a.key === 'old');

  return (
    <>
      <h2 style={{ margin: '26px 0 0' }}>Owner view</h2>

      <Section id="profit" open bad={broken(p)} title={`1. True net profit · ${periodLabel}${broken(p) ? '' : ` · ${money(p.net)}`}`}>
        {!broken(p) && (<>
          <Table rows={[
            line('Sales (before tax)', p.revenue), line('− Cost of goods sold', -p.cogs), line('= Gross profit', p.gross, true),
            line('− Wages paid', -p.wages), line('− Running bills', -p.running), line('− Advertising logged on Marketing', -p.ads),
            line('= Net profit', p.net, true), line('− Owner draws', -p.draws), line('− Loan repayments', -p.loans),
            line('= Left in the business', p.kept, true)
          ]} cols={[
            { h: 'Line', f: (r) => (r.strong ? <strong>{r.label}</strong> : r.label) },
            { h: 'Amount', r: true, f: (r) => (r.strong ? <strong>{money(r.value)}</strong> : money(r.value)), neg: (r) => r.strong && r.value < 0 }
          ]} />
          {p.owed && (p.owed.total > 0 || p.owed.thisWeek > 0) && (
            <p className="hint">Not in these figures yet: {money(p.owed.total)} wages owed through last week and {money(p.owed.thisWeek)} earned this week. Once all of it is paid, net profit is that much lower.</p>
          )}
        </>)}
      </Section>

      <Section id="cash" open bad={broken(f)} title="2. 13-week cash forecast">
        {!broken(f) && <CashForecast f={f} />}
      </Section>

      <Section id="worth" open bad={broken(w)} title={`3. Net worth${w.complete ? ` · ${money(w.net)}` : ' · incomplete'}`}>
        <div className="dash-2col">
          {[['What we have', w.assets, w.totalAssets], ['What we owe', w.liabilities, w.totalLiabilities]].map(([title, rows, total]) => (
            <div key={title}>
              <h3 style={{ margin: '0 0 6px' }}>{title}</h3>
              <Table rows={[...rows, { label: 'Total', value: total, strong: true }]} cols={[
                { h: 'Item', f: (r) => <>{r.strong ? <strong>{r.label}</strong> : r.label}{r.note ? <span className="hint" style={{ display: 'block', margin: 0 }}>{r.note}</span> : null}</> },
                { h: 'Amount', r: true, f: (r) => (r.value == null ? 'not known' : money(r.value)) }
              ]} />
            </div>
          ))}
        </div>
        <p style={{ fontSize: 15 }}>Net worth: <strong style={w.net < 0 ? red : null}>{money(w.net)}</strong>{!w.complete && ' (at least one line is not known, so this is not the full picture)'}</p>
        <p className="hint">Supplier and vendor amounts are what is recorded as unpaid. If some were already paid, mark them paid on the <a href="/admin/reports/ledger" style={{ textDecoration: 'underline' }}>ledger</a> and this goes up.</p>
        {history.length > 0 && (<>
          <h3 style={{ margin: '14px 0 6px' }}>Month by month</h3>
          <Table rows={[...history].reverse()} cols={[
            { h: 'Month', f: (r) => monthName(r.month) }, { h: 'Have', r: true, f: (r) => money(r.assets) },
            { h: 'Owe', r: true, f: (r) => money(r.liabilities) }, { h: 'Net worth', r: true, f: (r) => money(r.net), neg: (r) => r.net < 0 }
          ]} />
          <p className="hint">Saved from the day this section started; earlier months were never recorded.</p>
        </>)}
      </Section>

      <Section id="trend" bad={broken(trend)} title="4. 12-month trend">
        <TrendChart series={trendRows.map((r) => ({ label: monthName(r.month), value: r.revenue }))} label="monthly-sales" />
        <Table rows={[...trendRows].reverse()} cols={[
          { h: 'Month', f: (r) => <>{monthName(r.month)}{r.partial && <span className="hint" style={{ marginLeft: 6 }}>so far</span>}{r.thin && <span className="pill warn" style={{ marginLeft: 6 }}>bills missing</span>}</> },
          { h: 'Sales', r: true, f: (r) => money(r.revenue) },
          { h: 'Change', r: true, f: (r) => (r.change == null || r.partial ? '—' : `${r.change > 0 ? '+' : ''}${r.change.toFixed(0)}%`), neg: (r) => !r.partial && r.change < 0 },
          { h: 'Gross profit', r: true, f: (r) => money(r.gross) }, { h: 'Margin', r: true, f: (r) => pct(r.margin) },
          { h: 'Wages', r: true, f: (r) => money(r.wages) }, { h: 'Bills and ads', r: true, f: (r) => money(r.costs + r.ads) },
          { h: 'Net profit', r: true, f: (r) => money(r.net), neg: (r) => r.net < 0 }
        ]} />
        <p className="hint">Months marked &quot;bills missing&quot; have little or nothing from the bank feed, so their net profit reads far higher than it was.</p>
      </Section>

      <Section id="targets" open bad={broken(goals)} title="5. Targets this month">
        {!broken(goals) && (<>
          <p className="hint" style={{ marginTop: 0 }}>Day {goals.day} of {goals.daysInMonth}. &quot;On pace for&quot; is this month so far, carried to the end of the month. Net profit swings with when big bills land.</p>
          <Table rows={goals.lines} cols={[
            { h: 'Measure', f: (r) => r.label }, { h: 'So far', r: true, f: (r) => money(r.actual) },
            { h: 'Target', r: true, f: (r) => (r.target == null ? 'not set' : money(r.target)) },
            { h: 'On pace for', r: true, f: (r) => money(r.projected), neg: (r) => r.gap != null && r.gap < 0 },
            { h: 'Reached', r: true, f: (r) => pct(r.pct) },
            { h: 'Needed per day left', r: true, f: (r) => (r.perDayNeeded == null ? '—' : money(r.perDayNeeded)) }
          ]} />
          {admin && <FinanceTargets targets={goals.targets} />}
        </>)}
      </Section>

      <Section id="even" open bad={broken(even)} title="6. Break-even and runway">
        {!broken(even) && (<>
          <Stats items={[
            { label: 'Sales needed per day', value: $(even.breakEvenPerDay), sub: 'before tax, to cover wages and bills' },
            { label: 'Sales per day now', value: $(even.salesPerDay), sub: even.cushion == null ? '' : `${Math.abs(even.cushion).toFixed(0)}% ${even.cushion >= 0 ? 'above' : 'below'} break-even`, bad: even.cushion < 0 },
            { label: 'Costs per day', value: $(even.costPerDay), sub: `margin on sales ${pct(even.margin)}` },
            { label: 'Runway if sales stopped', value: days(even.runwayDays), sub: 'cash on hand ÷ daily costs', bad: even.runwayDays != null && even.runwayDays < 30 }
          ]} />
          <p className="hint">Costs and sales are the last {even.days} days (since {day(even.since)}); margin is up to 90 days. Owner draws and stock purchases are not counted as costs.</p>
        </>)}
      </Section>

      <Section id="stock" bad={broken(s)} title={`7. Stock aging and turnover${old ? ` · ${money(old.cost)} over 90 days` : ''}`}>
        {!broken(s) && (<>
          <Stats items={[
            { label: 'Stock we own, at cost', value: money(s.ownedCost), sub: `${s.ownedUnits} units${s.noCost ? `, ${s.noCost} with no cost` : ''}` },
            { label: 'Days of stock on hand', value: days(c?.stockDays), sub: c?.turns ? `turns ${c.turns.toFixed(1)} times a year` : '' },
            { label: 'Days from arrival to sale', value: days(s.daysToSell), sub: `${s.datedSales} sales in the last 90 days` },
            { label: 'Consigned, not ours', value: money(s.consignedCost), sub: `${s.consignedUnits} units` }
          ]} />
          <Table rows={s.ages} cols={[
            { h: 'Age', f: (r) => r.label }, { h: 'Units', r: true, f: (r) => r.units }, { h: 'Cost', r: true, f: (r) => money(r.cost) },
            { h: 'No cost on file', r: true, f: (r) => r.noCost || '—' }
          ]} />
          <h3 style={{ margin: '14px 0 6px' }}>Most money stuck over 90 days</h3>
          <Table empty="Nothing over 90 days." rows={s.oldest} cols={[
            { h: 'SKU', f: (u) => u.sku }, { h: 'Unit', f: (u) => [u.make, u.model, u.category].filter(Boolean).join(' ') },
            { h: 'Status', f: (u) => u.status }, { h: 'Days', r: true, f: (u) => u.age }, { h: 'Cost', r: true, f: (u) => money(u.cost) }
          ]} />
        </>)}
      </Section>

      <Section id="returns" bad={broken(s)} title="8. Return by supplier, brand, category and lot">
        {!broken(s) && (<>
          <p className="hint" style={{ marginTop: 0 }}>All time, from the tracker, priced from the sale. Profit is sale price less unit cost on units where both are known. Units sold on a typed line with no unit attached still show as in stock.</p>
          <Returns title="Supplier" rows={s.byVendor} />
          <Returns title="Brand" rows={s.byBrand} />
          <Returns title="Category" rows={s.byCategory} />
          <Returns title="Lot (top 25 by profit)" rows={s.byLot} />
        </>)}
      </Section>

      <Section id="cycle" bad={broken(c)} title="9. Cash cycle">
        {!broken(c) && (<>
          <Stats items={[
            { label: 'Days stock sits', value: days(c.stockDays) },
            { label: 'Days to get paid', value: days(c.collectDays) },
            { label: 'Money tied up before supplier credit', value: days(c.beforeCredit) },
            { label: 'Days we take to pay suppliers', value: days(c.payDays), sub: 'from invoices not marked paid' },
            { label: 'Cash cycle', value: days(c.cycle), sub: 'shorter is better' }
          ]} />
          <p className="hint">Measured over the last {c.days} days.
            {c.suppliers && c.suppliers.over60 > 0 ? ` ${money(c.suppliers.over60)} of supplier invoices are over 60 days old and not marked paid, so the supplier days and the cash cycle are only right if that is truly still owed.` : ''}</p>
        </>)}
      </Section>

      <Section id="ads" bad={broken(ads)} title={`10. Ad return · ${periodLabel}`}>
        {!broken(ads) && (<>
          <Table rows={ads.rows.filter((r) => r.spend > 0 || r.sales > 0)} cols={[
            { h: 'Platform', f: (r) => r.label }, { h: 'Spent', r: true, f: (r) => money(r.spend) },
            { h: 'Sales from it', r: true, f: (r) => (r.key === 'other' ? '—' : r.sales) },
            { h: 'Sales value', r: true, f: (r) => (r.key === 'other' ? '—' : money(r.revenue)) },
            { h: 'Gross profit', r: true, f: (r) => (r.key === 'other' ? '—' : money(r.profit)) },
            { h: 'Ad cost per sale', r: true, f: (r) => $(r.costPerSale) },
            { h: 'Profit per $1 spent', r: true, f: (r) => (r.profitPerDollar == null ? '—' : money(r.profitPerDollar)), neg: (r) => r.profitPerDollar != null && r.profitPerDollar < 1 }
          ]} />
          <h3 style={{ margin: '14px 0 6px' }}>Sales that came without an ad platform</h3>
          <Table rows={ads.other} cols={[
            { h: 'Source', f: (r) => r.label }, { h: 'Sales', r: true, f: (r) => r.sales },
            { h: 'Sales value', r: true, f: (r) => money(r.revenue) }, { h: 'Gross profit', r: true, f: (r) => money(r.profit) }
          ]} />
          <p className="hint">A sale is credited to what the customer said. Facebook counts both Marketplace and Facebook / Instagram answers, including free Marketplace posts, so its return reads high. Where the bank and the Marketing page both show spend for a platform, the larger one is used.</p>
        </>)}
      </Section>
    </>
  );
}
