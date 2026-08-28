'use client';
import { useCallback, useEffect, useState } from 'react';
import Mileage from './Mileage';

// What the delivery side of the business actually makes, day by day, week by
// week, month by month.
//
// Dispatch already held both halves of the money — what the client is charged
// and what the driver is paid — but nothing put them beside each other, and fuel
// wasn't recorded anywhere at all. A day that grossed $900, paid out $400 and
// burned $120 of diesel is a different business from one that burned $40.
//
// The honesty rules this screen follows, because a number nobody trusts is worse
// than no number:
//   · a stop with neither a charge nor an order behind it counts as zero AND is
//     reported as unpriced, so a short total can never look like a finished one;
//   · gas is dated, never spread across stops — a tank goes into a van, and
//     splitting it per delivery would be a guess dressed up as a figure;
//   · the revenue on every line says where it came from, because a typed charge
//     is somebody's decision and an order's delivery fee is arithmetic.
const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Number(n) || 0).toFixed(2);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const shift = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};
const monthsBack = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() - n, 1);
  return d.toLocaleDateString('en-CA');
};
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);

// Each view picks its own window, because "daily" over eighteen months is not a
// screen anybody reads.
const VIEWS = {
  day:   { label: 'Daily',   back: (t) => shift(t, -13) },
  week:  { label: 'Weekly',  back: (t) => shift(t, -55) },
  month: { label: 'Monthly', back: (t) => monthsBack(t, 11) }
};

export default function ProfitReport({ drivers = [], date }) {
  const t = today();
  const [group, setGroup] = useState('day');
  const [from, setFrom] = useState(VIEWS.day.back(t));
  const [to, setTo] = useState(t);
  const [custom, setCustom] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [showLines, setShowLines] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f, tt, g) => {
    setLoading(true); setErr('');
    try {
      const d = await fetch(`/api/admin/dispatch?view=profit&from=${f}&to=${tt}&group=${g}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setData(d);
    } catch { setErr('Network error — could not load the figures.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(from, to, group); /* eslint-disable-next-line */ }, []);

  function pickGroup(g) {
    setGroup(g); setCustom(false);
    const f = VIEWS[g].back(t);
    setFrom(f); setTo(t); load(f, t, g);
  }

  async function post(body) {
    setBusy(true); setErr(''); setOk('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That didn’t work.'); return false; }
      await load(from, to, group);
      return d;
    } catch { setErr('Network error — nothing was saved.'); return false; }
    finally { setBusy(false); }
  }

  async function addExpense(e) {
    const r = await post({ action: 'expense', ...e });
    if (r) setOk(`${r.expense.kindLabel} ${money(r.expense.amount)} recorded for ${r.expense.date}.`);
  }

  async function removeExpense(id) {
    if (!window.confirm('Remove this cost?')) return;
    await post({ action: 'delete_expense', id });
  }

  const totals = data?.totals || {};

  return (
    <div>
      <div className="inv-search" style={{ marginBottom: 12 }}>
        {Object.entries(VIEWS).map(([k, v]) => (
          <button key={k} type="button"
            className={'svc-chip' + (group === k && !custom ? ' is-on' : '')}
            onClick={() => pickGroup(k)}>{v.label}</button>
        ))}
        <button type="button" className={'svc-chip' + (custom ? ' is-on' : '')}
          onClick={() => setCustom(true)}>Custom</button>
        {custom && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 120 }}>
              {Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button type="button" className="btn accent" onClick={() => load(from, to, group)}>Show</button>
          </>
        )}
      </div>

      {err && <div className="error-box">{err}</div>}
      {ok && <div className="notice-box">{ok}</div>}

      {data && (
        <>
          <div className="dash-kpis" style={{ marginBottom: 14 }}>
            <div className="kpi-card">
              <div className="kpi-value">{money(totals.revenue)}</div>
              <div className="kpi-label">Charged out</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{money(totals.cost)}</div>
              <div className="kpi-label">
                Cost — {money(totals.driverPay)} drivers · {money(totals.gas)} gas
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{money(totals.profit)}</div>
              <div className="kpi-label">
                Left over{totals.margin != null ? ` · ${totals.margin}% margin` : ''}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{totals.jobs || 0}</div>
              <div className="kpi-label">
                Delivered · {totals.hours || 0}h on site
                {totals.failed > 0 && ` · ${totals.failed} couldn't be completed`}
              </div>
            </div>
          </div>

          {(totals.unpricedRevenue > 0 || totals.unpricedPay > 0) && (
            <div className="notice-box">
              {totals.unpricedRevenue > 0 && (
                <>
                  {totals.unpricedRevenue} finished stop{totals.unpricedRevenue === 1 ? ' has' : 's have'} nothing
                  to charge against {totals.unpricedRevenue === 1 ? 'it' : 'them'} — no client charge and no Bargain
                  Bay order — so the revenue above is short by whatever those were worth.{' '}
                </>
              )}
              {totals.unpricedPay > 0 && (
                <>
                  {totals.unpricedPay} {totals.unpricedPay === 1 ? 'has' : 'have'} no driver pay set, so the cost is
                  short too. Both are set on the job card.
                </>
              )}
            </div>
          )}

          <div className="panel">
            <div className="table-wrap"><table className="admin">
              <thead>
                <tr>
                  <th>{group === 'month' ? 'Month' : group === 'week' ? 'Week' : 'Day'}</th>
                  <th style={{ textAlign: 'right' }}>Stops</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                  <th style={{ textAlign: 'right' }}>Charged</th>
                  <th style={{ textAlign: 'right' }}>Drivers</th>
                  <th style={{ textAlign: 'right' }}>Gas</th>
                  <th style={{ textAlign: 'right' }}>Other</th>
                  <th style={{ textAlign: 'right' }}>Profit</th>
                  <th style={{ textAlign: 'right' }}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>Loading…</td></tr>}
                {!loading && data.buckets.length === 0 && (
                  <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>
                    Nothing finished, and nothing spent, in that period.
                  </td></tr>
                )}
                {!loading && data.buckets.map((b) => (
                  <tr key={b.key}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{b.label}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {b.jobs || '—'}
                      {b.failed > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>+{b.failed} failed</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.hours || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(b.revenue)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(b.driverPay)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(b.gas)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(b.otherCost)}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: b.profit < 0 ? 'var(--danger, #c0392b)' : undefined
                    }}>{money(b.profit)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>
                      {b.margin == null ? '—' : `${b.margin}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="hint">
              Charged is what the client pays: the charge typed on the job, or — for a Bargain Bay delivery — the
              delivery fee on the order. Cost is what the stop paid its driver, plus the gas and anything else
              recorded against that day. A stop that <b>couldn&apos;t be completed</b> earns nothing and is still
              counted, because it cost the same driver and the same fuel.
            </p>
          </div>

          {data.drivers.length > 0 && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>By driver</h3>
              <div className="table-wrap"><table className="admin">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th style={{ textAlign: 'right' }}>Stops</th>
                    <th style={{ textAlign: 'right' }}>Hours</th>
                    <th style={{ textAlign: 'right' }}>Brought in</th>
                    <th style={{ textAlign: 'right' }}>Paid</th>
                    <th style={{ textAlign: 'right' }}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drivers.map((d) => (
                    <tr key={d.driverId || d.name}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.jobs}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.hours || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.revenue)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.pay)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {money(d.revenue - d.pay)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p className="hint">
                Gas isn&apos;t in this table: it is recorded against a DAY, not a stop, so splitting it per driver
                would be a guess. The difference column is before fuel.
              </p>
            </div>
          )}

          <Mileage from={data.from} to={data.to} />

          <GasPanel kinds={data.kinds} drivers={drivers} expenses={data.expenses} defaultDate={date || t}
            busy={busy} onAdd={addExpense} onRemove={removeExpense} />

          <div className="panel">
            <button type="button" className="disp-toggle" onClick={() => setShowLines((v) => !v)}>
              {showLines ? 'Hide the stops behind these numbers' : `Show the ${data.lines.length} stops behind these numbers`}
            </button>
            {showLines && (
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="admin">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Stop</th>
                    <th>Driver</th>
                    <th>On site</th>
                    <th style={{ textAlign: 'right' }}>Charged</th>
                    <th style={{ textAlign: 'right' }}>Paid</th>
                    <th style={{ textAlign: 'right' }}>Left</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{l.date}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {l.customerName || '(no name)'}
                          {l.status === 'failed' && <span className="disp-late"> · couldn&apos;t complete</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                          {l.jobNumber}{l.orderNumber ? ` · ${l.orderNumber}` : ''}
                          {l.clientName ? ` · ${l.clientName}` : ''}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{l.driverName || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {l.timeIn && l.timeOut ? `${hhmm(l.timeIn)}–${hhmm(l.timeOut)}` : '—'}
                        {l.minutes != null && <> ({l.minutes}m)</>}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {l.revenueKnown ? money(l.revenue) : <span className="disp-late">not priced</span>}
                        {l.revenueFrom === 'order_fee' && (
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>order&apos;s delivery fee</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {l.pay == null ? <span className="disp-late">not set</span> : money(l.pay)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {money(l.revenue - (l.pay || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Gas, and everything else a day costs that isn't one stop's. Dated rather than
// timestamped and enterable for ANY day, because that is how a receipt behaves:
// it is filled in at the pump if somebody is quick, and out of the glovebox on
// Friday if they aren't.
function GasPanel({ kinds = {}, drivers = [], expenses = [], defaultDate, busy, onAdd, onRemove }) {
  const [date, setDate] = useState(defaultDate);
  const [kind, setKind] = useState('gas');
  const [amount, setAmount] = useState('');
  const [driverId, setDriverId] = useState('');
  const [note, setNote] = useState('');

  return (
    <section className="panel">
      <h3 style={{ marginTop: 0 }}>Gas &amp; day costs</h3>
      <form
        className="disp-setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!(Number(amount) > 0)) return;
          onAdd({ date, kind, amount: Number(amount), driverId: driverId || null, note });
          setAmount(''); setNote('');
        }}
      >
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input inputMode="decimal" value={amount} placeholder="Amount *"
          onChange={(e) => setAmount(e.target.value)} />
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Which van / driver (optional)</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
        <button className="btn accent" disabled={busy || !(Number(amount) > 0)}>Record</button>
      </form>

      {expenses.length === 0
        ? <p className="hint">Nothing recorded in this period.</p>
        : (
          <ul className="disp-setup-list">
            {expenses.map((x) => (
              <li key={x.id}>
                <strong>{x.date}</strong>
                <span className="hint" style={{ margin: 0 }}>
                  {' '}· {x.kindLabel} {money(x.amount)}
                  {x.driverName ? ` · ${x.driverName}` : ''}
                  {x.note ? ` · ${x.note}` : ''}
                  {x.byName ? ` · entered by ${x.byName}` : ''}
                </span>
                <button type="button" className="disp-toggle" style={{ marginLeft: 8 }} disabled={busy}
                  onClick={() => onRemove(x.id)}>remove</button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
