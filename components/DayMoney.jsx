'use client';
// Every day's money in one table: what was sold, what has to go back into
// product, and what was left, two ways: PROPOSED from our own numbers (clock-ins,
// truck, cost list) and ACTUAL from what was really paid. Click a day to see its
// sales and payments. Admin only.
import { Fragment, useCallback, useEffect, useState } from 'react';
import SalesDetail from './SalesDetail';
import { addMonths, monthName } from '../lib/rep-periods';
import { daysIn } from '../lib/month-sales';

const $ = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const minus = (v) => (v > 0 ? `−${$(v)}` : $(v));
const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const shift = (iso, d) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const head = { textAlign: 'right' }; // headings may wrap; figures never do
const netColour = (v) => (v == null ? 'var(--muted)' : v < 0 ? 'var(--danger)' : 'var(--ok)');
const known = (v) => (v == null ? '—' : $(v));
const small = { fontSize: 12, color: 'var(--muted)', fontWeight: 400 };

function Payments({ spend }) {
  if (!spend) return <p className="hint">The payments for this day could not be read.</p>;
  if (!spend.length) return <p className="hint">No payments recorded that day.</p>;
  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--charcoal)' }}>Payments that day</h3>
      <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
        <thead><tr><th>Paid to</th><th>Category</th><th style={right}>Amount</th><th>In actual net profit?</th></tr></thead>
        <tbody>{spend.map((l, i) => (
          <tr key={i}><td>{l.vendor || '—'}{l.source !== 'plaid' && <span style={{ ...small, marginLeft: 8 }}>{l.source === 'personal' ? 'own pocket' : l.source}</span>}</td>
            <td>{l.category}</td><td style={right}>{$(l.paid)}</td><td style={l.counted ? undefined : small}>{l.counted ? 'Yes' : 'No, money moving'}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

export default function DayMoney() {
  const [range, setRange] = useState('14'); // '14', or a month 'YYYY-MM'
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const [sales, setSales] = useState({});
  const [err, setErr] = useState('');
  const today = data?.today;

  const query = (() => {
    if (range === '14' || !today) return '';
    const last = `${range}-${String(daysIn(range)).padStart(2, '0')}`;
    return `?from=${range}-01&to=${last < today ? last : today}`;
  })();

  const load = useCallback(async (signal) => {
    try {
      const res = await fetch(`/api/admin/day-money${query}`, { cache: 'no-store', signal });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not load');
      // The headings follow the figures on screen, not the button just pressed.
      setData({ ...j, shown: query ? range : '14' }); setErr('');
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); }
  }, [query, range]);

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    const t = setInterval(() => load(ctl.signal), 60000);
    return () => { ctl.abort(); clearInterval(t); };
  }, [load]);

  // The open day's sales, fetched when it is opened and again with each refresh.
  useEffect(() => {
    if (!open) return undefined;
    const ctl = new AbortController();
    fetch(`/api/admin/day-money?day=${open}`, { cache: 'no-store', signal: ctl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not load'); return j; })
      .then((j) => setSales((s) => ({ ...s, [j.day]: { orders: j.orders, spend: j.spend } })))
      .catch((e) => { if (e.name !== 'AbortError') setSales((s) => ({ ...s, [open]: { error: e.message } })); });
    return () => ctl.abort();
  }, [open, data]);

  if (!data) {
    return <div className="panel" style={{ marginBottom: 14 }}><p className="hint" style={{ margin: 0 }}>{err ? `Day by day couldn't load: ${err}` : 'Loading day by day…'}</p></div>;
  }

  const t = data.totals;
  const thisMonth = data.today.slice(0, 7);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(`${thisMonth}-01`, -i).slice(0, 7));
  const rows = [...data.rows].reverse();
  const when = (d) => (d === data.today ? ' · today, so far' : d === shift(data.today, -1) ? ' · yesterday' : '');
  const title = data.shown === '14' ? 'Last 14 days' : monthName(`${data.shown}-01`);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Day by day · net profit, two ways, and what to keep aside</h2>
        <span className="hint" style={{ margin: 0 }}>Sales before HST · click a day to see its sales and payments</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" className={'dash-filter' + (range === '14' ? ' active' : '')} onClick={() => setRange('14')}>Last 14 days</button>
        <button type="button" className={'dash-filter' + (range === thisMonth ? ' active' : '')} onClick={() => setRange(thisMonth)}>This month</button>
        <button type="button" className={'dash-filter' + (range === months[1] ? ' active' : '')} onClick={() => setRange(months[1])}>Last month</button>
        <select value={months.includes(range) ? range : ''} onChange={(e) => e.target.value && setRange(e.target.value)} aria-label="Pick a month"
          style={{ width: 'auto', margin: 0, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' }}>
          <option value="">Any month…</option>
          {months.map((m) => <option key={m} value={m}>{monthName(`${m}-01`)}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
        {[
          ['Proposed net profit', $(t.net), `our numbers: ${$(t.wages + t.truck + t.bills)} wages, truck and bills`, netColour(t.net)],
          ['Actual net profit', known(t.actualNet), t.actualNet == null ? 'no bank record for all these days' : `bank spending: ${$(t.spent)} actually spent`, netColour(t.actualNet)],
          ['Keep aside for product', $(t.restock), t.vendorTax > 0 ? `includes ${$(t.vendorTax)} tax paid to drop-off vendors` : 'what the units sold cost'],
          ['Gross profit', $(t.grossProfit), `appliances less their cost · plus ${$(t.deliveryIn)} delivery and services`]
        ].map(([label, value, hint, colour]) => (
          <div key={label} style={{ border: '1px solid var(--line-soft)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{label} · {title}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: colour || 'var(--charcoal)' }}>{value}</div>
            <div className="hint" style={{ margin: 0 }}>{hint}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="admin" style={{ minWidth: 960 }}>
          <thead><tr>
            <th>Day</th><th style={head}>Proposed net profit</th><th style={head}>Actual net profit</th><th style={head}>Keep aside for product</th><th style={head}>Sales before tax</th>
            <th style={head}>Gross profit</th><th style={head}>+ Delivery &amp; services</th><th style={head}>Proposed costs</th><th style={head}>Actually spent</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.day}>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" aria-expanded={open === r.day} onClick={() => setOpen((d) => (d === r.day ? '' : r.day))}
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--charcoal)', font: 'inherit', fontWeight: 700, textAlign: 'left' }}>
                      {open === r.day ? '▾' : '▸'} {dayName(r.day)}
                    </button>
                    <div style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 16 }}>{r.sales} sale{r.sales === 1 ? '' : 's'}{when(r.day)}</div>
                  </td>
                  <td style={{ ...right, fontWeight: 700, color: netColour(r.net) }}>{$(r.net)}</td>
                  <td style={{ ...right, fontWeight: 700, color: netColour(r.actualNet) }}>{known(r.actualNet)}</td>
                  <td style={{ ...right, fontWeight: 700 }}>{$(r.restock)}{r.missingCost > 0 && <div><span className="pill warn" title="A unit sold this day has no cost on file, so this is too low and the profit leaves it out.">cost missing</span></div>}</td>
                  <td style={right}>{$(r.revenue)}<div style={small}>{$(r.revenueWithTax)} with tax</div></td>
                  <td style={right}>{$(r.grossProfit)}</td>
                  <td style={right}>{$(r.deliveryIn)}</td>
                  <td style={right}>{minus(r.wages + r.truck + r.bills)}<div style={small}>wages {$(r.wages)}</div><div style={small}>truck {$(r.truck)} · bills {$(r.bills)}</div></td>
                  <td style={right}>{r.spent == null ? '—' : minus(r.spent)}{r.unsorted > 0 && <div style={small}>{$(r.unsorted)} not sorted</div>}</td>
                </tr>
                {open === r.day && (
                  <tr><td colSpan={9} style={{ padding: '0 10px 12px' }}>
                    {!sales[r.day] ? <p className="hint">Loading the day…</p>
                      : sales[r.day].error ? <p className="hint" style={{ color: 'var(--danger)' }}>{sales[r.day].error}</p>
                        : (
                          <>
                            {sales[r.day].orders.length === 0 ? <p className="hint">No sales that day.</p>
                              : <SalesDetail orders={sales[r.day].orders} title={`Sales on ${dayName(r.day)}`} />}
                            <Payments spend={sales[r.day].spend} />
                          </>
                        )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td>Total · {t.sales} sales</td>
              <td style={{ ...right, color: netColour(t.net) }}>{$(t.net)}</td>
              <td style={{ ...right, color: netColour(t.actualNet) }}>{known(t.actualNet)}</td>
              <td style={right}>{$(t.restock)}</td><td style={right}>{$(t.revenue)}</td><td style={right}>{$(t.grossProfit)}</td>
              <td style={right}>{$(t.deliveryIn)}</td><td style={right}>{minus(t.wages + t.truck + t.bills)}</td>
              <td style={right}>{t.spent == null ? '—' : minus(t.spent)}{t.unsorted > 0 && <div style={small}>{$(t.unsorted)} not sorted</div>}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className="hint" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        <li>Delivery &amp; services count on the day the stop is done, so they differ from the service lines inside that day&apos;s sales.</li>
        {data.notes.map((n) => <li key={n.text}>{n.text} {n.href && <a href={n.href} style={{ textDecoration: 'underline' }}>{n.link} →</a>}</li>)}
      </ul>
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>Could not refresh: {err}</p>}
    </div>
  );
}
