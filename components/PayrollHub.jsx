'use client';
import { useState } from 'react';
import Payroll from './Payroll';

// The top of the Payroll page: one week, per person: the hours they clocked, what that comes to, and whether it is
// posted to what they are owed. Below it (same page) sit the running balances, the people and the hours.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const label = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export default function PayrollHub({ initial, today }) {
  const [state, setState] = useState(initial); // { payroll, pay }
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const w = state.payroll.week;

  async function call(body, labelText) {
    setBusy(labelText); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'payroll', weekStart: w.start, ...body }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'That failed.');
      setState({ payroll: j.payroll, pay: j.pay });
      return j;
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  // A week is a page: the people and hours below it are server-loaded for that week too.
  function goWeek(start) { window.location.href = `/admin/payroll?week=${start}`; }

  async function post(p) {
    const j = await call({ action: 'post_week', person: p.name }, `post-${p.name}`);
    if (j) setMsg(`Posted ${p.name}: ${cad(p.total)} owed for ${label(w.start)} – ${label(w.end)}.`);
  }
  async function postAll() {
    const j = await call({ action: 'post_all' }, 'all');
    if (j) { setMsg(`Posted ${j.posted} ${j.posted === 1 ? 'person' : 'people'}.`); if (j.skipped?.length) setErr(j.skipped.join(' · ')); }
  }

  return (
    <div>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h1 style={{ margin: 0, color: 'var(--charcoal)' }}>Payroll</h1>
          <button className="dash-filter" disabled={!!busy} onClick={() => goWeek(w.prev)}>‹ Previous week</button>
          <b>{label(w.start)} – {label(w.end)}</b>
          <button className="dash-filter" disabled={!!busy || w.start >= today} onClick={() => goWeek(w.next)}>Next week ›</button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Hours come from the clock (people clocking in, or the office adding a missed shift below). <b>Earned</b> is each shift&apos;s hours times the rate
          it carried. <b>Post</b> adds that week to what the person is owed; posting again after a change updates it, it never doubles.
        </p>
        {state.payroll.people.length === 0 ? <p className="hint" style={{ margin: 0 }}>Nobody clocked any hours this week.</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Person</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Earned</th><th style={{ textAlign: 'right' }}>Posted to owed</th><th /></tr></thead>
            <tbody>
              {state.payroll.people.map((p) => (
                <tr key={p.name}>
                  <td><b>{p.name}</b>
                    {p.open > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>still clocked in: fix the shift below before posting</div>}
                    {p.tooLong > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>{p.tooLong} shift{p.tooLong === 1 ? '' : 's'} too long to count (a forgotten clock-out?): fix below</div>}
                    {p.noRate > 0 && <div className="hint" style={{ margin: 0, color: 'var(--danger)', fontSize: 12.5 }}>{p.noRate} shift{p.noRate === 1 ? '' : 's'} with no hourly rate</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{p.hours.toFixed(2)}{p.shifts ? <span className="hint" style={{ margin: 0, fontSize: 12 }}> · {p.shifts} shift{p.shifts === 1 ? '' : 's'}</span> : null}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(p.total)}{p.piece ? <div className="hint" style={{ margin: 0, fontSize: 12 }}>incl. {cad(p.piece)} piece work</div> : null}</td>
                  <td style={{ textAlign: 'right' }}>{p.posted == null ? <span className="hint" style={{ margin: 0 }}>not posted</span> : cad(p.posted)}{p.stale && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>changed since: update</div>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {(p.posted == null || p.stale)
                      ? <button className="dash-filter active" disabled={!!busy || p.total <= 0} onClick={() => post(p)}>{p.posted == null ? 'Post to owed' : 'Update'}</button>
                      : <span className="hint" style={{ margin: 0 }}>✓ posted</span>}
                  </td>
                </tr>))}
              <tr>
                <td><b>Total</b></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{state.payroll.totals.hours.toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(state.payroll.totals.earned)}</td><td />
                <td style={{ textAlign: 'right' }}><button className="btn" disabled={!!busy} onClick={postAll}>{busy === 'all' ? 'Posting…' : 'Post everyone'}</button></td>
              </tr>
            </tbody></table></div>
        )}
        {err && <div className="error-box" style={{ marginTop: 8 }}>{err}</div>}
        {msg && <div className="notice-box" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <Payroll d={{ pay: state.pay, date: today, days: 7 }} setD={(j) => setState({ payroll: j.payroll || state.payroll, pay: j.pay || state.pay })} extra={{ view: 'payroll', weekStart: w.start }} />
    </div>
  );
}
