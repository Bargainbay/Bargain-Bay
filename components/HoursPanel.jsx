'use client';
// Everybody's hours on the Payroll tab: who is clocked in right now, and every
// shift (in, out, hours, pay) for today / yesterday / this week / last week /
// this month / last month. Reads /api/admin/hours, which reads BOTH clocks
// (the staff clock and the driver shifts) -- see lib/hours.js.
import { useState, useEffect, useCallback } from 'react';
import { money } from '../lib/constants';

const RANGES = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'],
  ['two_weeks_ago', 'Two weeks ago'], ['this_month', 'This month'], ['last_month', 'Last month']
];
const hm = (h) => { const m = Math.round((h || 0) * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const tm = (t) => (t ? new Date(t).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }) : '');
const NOTE = { open: 'Still clocked in', too_long: 'Too long — needs fixing', no_rate: 'No hourly rate', owner: 'Owner (not costed)', ok: '' };

export default function HoursPanel() {
  const [range, setRange] = useState('this_week');
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async (r) => {
    setErr('');
    try {
      const res = await fetch(`/api/admin/hours?range=${r}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load hours');
      setData(d);
    } catch (e) { setErr(e.message); }
  }, []);
  // "Who is in right now" is always today, whatever range is on screen.
  const loadLive = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/hours?range=today');
      if (res.ok) setLive(await res.json());
    } catch { /* the panel just stays as it was */ }
  }, []);
  useEffect(() => { load(range); }, [range, load]);
  useEffect(() => { loadLive(); const t = setInterval(loadLive, 60000); return () => clearInterval(t); }, [loadLive]);

  const inNow = (live?.shifts || []).filter((s) => s.status === 'open');
  const todayDone = (live?.shifts || []).filter((s) => s.status !== 'open');

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Hours — everyone</h2>
      {err && <div className="error-box">{err}</div>}

      <div style={{ marginBottom: 12 }}>
        <strong>In right now ({inNow.length})</strong>
        {inNow.length === 0
          ? <span className="hint"> — nobody is clocked in.</span>
          : <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{inNow.map((s) => (
              <li key={`${s.source}-${s.id}`}>{s.person} — in since {tm(s.start)}{s.role ? ` (${s.role})` : ''}</li>))}</ul>}
        {todayDone.length > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>
            Already out today: {todayDone.map((s) => `${s.person} ${tm(s.start)}–${tm(s.end)}`).join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {RANGES.map(([k, label]) => (
          <button key={k} type="button" className={`dash-filter${range === k ? ' active' : ''}`} onClick={() => setRange(k)}>{label}</button>
        ))}
      </div>

      {!data ? <p className="hint">Loading…</p> : (<>
        {data.warnings.map((w) => <div key={w} className="error-box" style={{ marginBottom: 8 }}>{w}</div>)}
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <span className="hint" style={{ margin: 0 }}>{data.from === data.to ? data.from : `${data.from} to ${data.to}`}</span>
          <strong>{hm(data.totals.hours)} · {money(data.totals.cost)}</strong>
        </div>

        <div className="table-wrap" style={{ marginTop: 8 }}><table className="admin">
          <thead><tr><th>Person</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Pay</th></tr></thead>
          <tbody>
            {data.people.length === 0 && <tr><td colSpan={4} className="hint">Nobody clocked in during this range.</td></tr>}
            {data.people.map((p) => (
              <tr key={p.email || p.person}>
                <td style={{ fontWeight: 600 }}>{p.person}</td>
                <td style={{ textAlign: 'right' }}>{p.daysWorked}</td>
                <td style={{ textAlign: 'right' }}>{hm(p.hours)}</td>
                <td style={{ textAlign: 'right' }}>{p.ownerHours && p.ownerHours === p.hours ? 'owner' : money(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <details open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Every shift ({data.shifts.length})</summary>
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="admin">
            <thead><tr><th>Day</th><th>Who</th><th>In</th><th>Out</th><th style={{ textAlign: 'right' }}>Time</th><th style={{ textAlign: 'right' }}>Rate</th><th></th></tr></thead>
            <tbody>
              {data.shifts.map((s) => (
                <tr key={`${s.source}-${s.id}`}>
                  <td>{s.day}</td><td>{s.person}</td><td>{tm(s.start)}</td>
                  <td>{s.end ? tm(s.end) : <b>still in</b>}</td>
                  <td style={{ textAlign: 'right' }}>{s.hours == null ? '—' : hm(s.hours)}</td>
                  <td style={{ textAlign: 'right' }}>{s.rate > 0 ? `$${Number(s.rate).toFixed(2)}` : '—'}</td>
                  <td className="hint">{[NOTE[s.status], s.edited && 'edited by office'].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="hint">Fix a staff shift on <a href="/admin/team-clock">Team clock</a>; a driver shift on the <a href="/admin/dispatch">dispatch</a> Times tab.</p>
        </details>
      </>)}
    </div>
  );
}
