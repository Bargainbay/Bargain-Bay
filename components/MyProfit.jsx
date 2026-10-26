'use client';
// "What have I made today" — the day's gross profit against the commission line,
// sale by sale, and the month so far. Commission is paid on gross profit, so this
// is the number a rep works to. Starts from what the page loaded and refreshes
// itself, so a sale closed a minute ago shows without a reload.
import { useEffect, useState } from 'react';

const $ = (v) => `$${Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $0 = (v) => `$${Math.round(Number(v || 0)).toLocaleString('en-CA')}`;

export default function MyProfit({ initial }) {
  const [data, setData] = useState(initial);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/admin/rep-profit', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (live && d && d.ready) { setData(d); setErr(''); } })
      .catch(() => { if (live) setErr('Could not refresh — showing the last numbers loaded.'); });
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const me = data?.me;
  if (!me) return null;
  const { rule } = data;
  const t = me.today, m = me.month;
  const pct = Math.min(100, (t.gp / rule.threshold) * 100);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Today’s gross profit</h2>
        <span className="hint" style={{ margin: 0 }}>
          You earn {rule.pct}% of the day’s gross profit once it reaches {$0(rule.threshold)} · before HST
        </span>
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--charcoal)' }}>
            {$(t.gp)} <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--muted)' }}>of {$0(rule.threshold)}</span>
          </div>
          <div role="img" aria-label={`${pct.toFixed(0)} percent of the way to ${$0(rule.threshold)} gross profit today`}
            style={{ height: 10, borderRadius: 5, background: 'var(--line-soft)', margin: '8px 0 6px' }}>
            <div style={{ height: 10, borderRadius: 5, width: `${pct}%`, background: 'var(--charcoal)' }} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--charcoal)' }}>
            {t.hit
              ? <><span className="pill ok">Commission earned</span> <b>{$(t.commission)}</b> today, and it grows with every dollar more.</>
              : <><b>{$(t.toGo)}</b> to go to unlock <b>{$(Math.max(rule.threshold, 0) * rule.pct / 100)}</b> today.</>}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {t.sales} sale{t.sales === 1 ? '' : 's'} closed today. A sale counts on the day it is invoiced, and a refund takes it back.
          </div>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>This month · {data.label}</h3>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--charcoal)', marginTop: 4 }}>{$(m.commission)}</div>
          <div className="hint">commission earned so far, from {$(m.gp)} gross profit.</div>
          <div className="hint">You reached {$0(rule.threshold)} on {m.daysHit} of {m.daysSold} day{m.daysSold === 1 ? '' : 's'} you sold.</div>
        </div>
      </div>

      {t.orders.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Sale</th><th>Time</th><th style={{ textAlign: 'right' }}>Gross profit</th></tr></thead>
            <tbody>
              {t.orders.map((o) => (
                <tr key={o.number}>
                  <td>{o.number}{o.units > 1 ? ` · ${o.units} units` : ''}</td>
                  <td>{o.at}</td>
                  <td style={{ textAlign: 'right' }}>
                    {$(o.gp)}{o.missing > 0 && <span title="A unit on this sale has no cost on file, so its profit is counted as $0 until the cost is entered." className="pill warn" style={{ marginLeft: 6 }}>cost missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {me.missingCost > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          {me.missingCost} unit{me.missingCost === 1 ? '' : 's'} sold this month {me.missingCost === 1 ? 'has' : 'have'} no cost on file, so the profit shown is lower than the real figure. Tell the office and it will be corrected.
        </p>
      )}
      {err && <p className="hint" style={{ color: 'var(--danger, #c0392b)' }}>{err}</p>}
    </div>
  );
}
