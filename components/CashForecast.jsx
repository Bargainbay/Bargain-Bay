'use client';
// Thirteen weeks of cash, re-worked as the assumptions are changed. The starting assumptions are the last four
// weeks of real money; nothing typed here is saved.
import { useState } from 'react';
import { money } from '../lib/constants';
import { cashForecast } from '../lib/finance-insights-math';

const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const red = { color: 'var(--danger, #ff6b6b)', fontWeight: 700 };
const right = { textAlign: 'right', whiteSpace: 'nowrap' };

export default function CashForecast({ f }) {
  const base = {
    weeklyIn: f.weeklyIn, weeklyStock: f.weeklyCogs, weeklyWages: f.weeklyWages,
    weeklyRunning: f.weeklyRunning, weeklyDraws: f.weeklyDraws, weeklyPaydown: 0
  };
  const [v, setV] = useState(base);
  const num = (k) => Number(v[k]) || 0;
  const r = cashForecast({
    today: f.today, start: f.start, owedOld: f.owedOld, dated: f.dated,
    weeklyIn: num('weeklyIn'), weeklyStock: num('weeklyStock'), weeklyWages: num('weeklyWages'),
    weeklyRunning: num('weeklyRunning'), weeklyDraws: num('weeklyDraws'), weeklyPaydown: num('weeklyPaydown')
  });
  const fields = [
    ['weeklyIn', 'Money in each week', 'customer payments, tax included'],
    ['weeklyStock', 'Spent on new stock each week', `starts at the cost of what sells; the bank shows ${money(f.weeklySupplierPaid)} to suppliers`],
    ['weeklyWages', 'Wages each week', 'wages actually paid'],
    ['weeklyRunning', 'Running bills each week', 'rent, fuel, truck, ads, parts, fees'],
    ['weeklyDraws', 'Owner draws and loans each week', 'taken out of the business'],
    ['weeklyPaydown', 'Paying old balances each week', `${money(f.owedOld)} recorded as owed to suppliers and vendors`]
  ];
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        Starts from <strong>{money(f.start)}</strong> on hand today. The weekly amounts are the average of the last {f.window.days} days
        {f.bankFeed ? '' : ' (no bank feed lines yet, so bills are probably missing)'}. Change any of them to try a plan.
        {!f.cashKnown && ' The till has not been counted, so cash on hand is missing from the start.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {fields.map(([k, label, hint]) => (
          <label key={k} style={{ display: 'block', fontSize: 13 }}>
            {label}
            <input type="number" min="0" step="50" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={{ width: '100%' }} />
            <span className="hint" style={{ margin: 0, display: 'block' }}>{hint}</span>
          </label>
        ))}
      </div>
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setV(base)}>Back to actual averages</button>
      <div style={{ margin: '12px 0', fontSize: 15 }}>
        In 13 weeks: <strong style={r.end < 0 ? red : null}>{money(r.end)}</strong>. Lowest point:{' '}
        <strong style={r.lowest.closing < 0 ? red : null}>{money(r.lowest.closing)}</strong> in the week of {day(r.lowest.from)}.
        {r.firstShort && <span style={red}> Cash runs out in the week of {day(r.firstShort.from)}.</span>}
      </div>
      <div className="table-wrap">
        <table className="admin" style={{ minWidth: 0 }}>
          <thead><tr><th>Week</th><th style={right}>Start</th><th style={right}>In</th><th style={right}>Out</th><th style={right}>End</th></tr></thead>
          <tbody>{r.rows.map((w) => (
            <tr key={w.week}>
              <td>{day(w.from)} to {day(w.to)}{w.labels.length ? <span className="pill warn" style={{ marginLeft: 6 }}>{w.labels.join(', ')} {money(w.oneOff)}</span> : null}</td>
              <td style={right}>{money(w.opening)}</td><td style={right}>{money(w.in)}</td><td style={right}>{money(w.out)}</td>
              <td style={{ ...right, ...(w.closing < 0 ? red : {}) }}>{money(w.closing)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="hint">
        Old supplier and vendor balances are paid only as much as you enter above.
        {f.previousHst && f.previousHst.net > 0 ? ` HST for ${f.previousHst.quarter} (${money(f.previousHst.net)}, due ${day(f.previousHst.due)}) is not included: take it off if it has not been paid.` : ''}
      </p>
    </>
  );
}
