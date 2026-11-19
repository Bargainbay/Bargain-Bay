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
// 24-hour HH:MM in Toronto, the shape the fix endpoints take and a time input shows.
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const NOTE = { open: 'Still clocked in', too_long: 'Too long — needs fixing', no_rate: 'No hourly rate', owner: 'Owner (not costed)', ok: '' };

export default function HoursPanel() {
  const [range, setRange] = useState('this_week');
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState('');
  // Correcting a shift happens HERE, for both clocks (owner, 2026-11-19: nothing is fixed on Team clock).
  const [fix, setFix] = useState(null);
  const [saving, setSaving] = useState(false);
  // A shift that is still open is not counted in the totals (it cannot be costed yet), but the
  // time so far is worth seeing, so it is shown beside them and ticks every 30 seconds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const soFar = (s) => (s && !s.end && s.start ? Math.max(0, (now - new Date(s.start).getTime()) / 3600000) : 0);

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

  async function saveFix() {
    if (!fix) return;
    setSaving(true); setErr('');
    try {
      const staff = fix.source === 'staff';
      const res = await fetch(staff ? '/api/admin/team-clock' : '/api/admin/dispatch', {
        method: staff ? 'POST' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staff
          ? { action: 'fix_shift', id: fix.id, date: fix.day, start: fix.start, end: fix.still ? undefined : fix.end, clear: !!fix.still }
          : { action: 'shift_times', shiftId: fix.id, startTime: fix.start, endTime: fix.still ? undefined : fix.end, clear: !!fix.still })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not save that shift.');
      setFix(null);
      await Promise.all([load(range), loadLive()]);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

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
              <li key={`${s.source}-${s.id}`}>{s.person} — in since {tm(s.start)} · {hm(soFar(s))} so far{s.role ? ` (${s.role})` : ''}</li>))}</ul>}
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
                <td style={{ textAlign: 'right' }}>
                  {hm(p.hours)}
                  {(() => { const open = data.shifts.filter((x) => !x.end && (x.email || x.person) === (p.email || p.person)).reduce((a, x) => a + soFar(x), 0); return open > 0 ? <span className="hint"> + {hm(open)} so far</span> : null; })()}
                </td>
                <td style={{ textAlign: 'right' }}>{p.ownerHours && p.ownerHours === p.hours ? 'owner' : money(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>

        <details open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Every shift ({data.shifts.length})</summary>
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="admin">
            <thead><tr><th>Day</th><th>Who</th><th>In</th><th>Out</th><th style={{ textAlign: 'right' }}>Time</th><th style={{ textAlign: 'right' }}>Rate</th><th></th><th></th></tr></thead>
            <tbody>
              {data.shifts.map((s) => (
                <tr key={`${s.source}-${s.id}`}>
                  <td>{s.day}</td><td>{s.person}</td><td>{tm(s.start)}</td>
                  <td>{s.end ? tm(s.end) : <b>still in</b>}</td>
                  <td style={{ textAlign: 'right' }}>{s.end ? (s.hours == null ? '—' : hm(s.hours)) : <span title="Not counted in the totals until they clock out">{hm(soFar(s))} so far</span>}</td>
                  <td style={{ textAlign: 'right' }}>{s.rate > 0 ? `$${Number(s.rate).toFixed(2)}` : '—'}</td>
                  <td className="hint">{[NOTE[s.status], s.edited && 'edited by office'].filter(Boolean).join(' · ')}</td>
                  <td><button type="button" className="dash-filter" onClick={() => setFix({ source: s.source, id: s.id, who: s.person, day: s.day, start: hhmm(s.start), end: hhmm(s.end), still: !s.end })}>Fix times</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {fix && (
            <div className="panel" style={{ marginTop: 8 }}>
              <strong>Fix shift — {fix.who}, {fix.day}</strong>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
                <label>In<br /><input type="time" value={fix.start} onChange={(e) => setFix({ ...fix, start: e.target.value })} /></label>
                <label>Out<br /><input type="time" value={fix.end} disabled={fix.still} onChange={(e) => setFix({ ...fix, end: e.target.value })} /></label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={fix.still} onChange={(e) => setFix({ ...fix, still: e.target.checked })} /> Still clocked in</label>
                <button type="button" className="dash-filter active" disabled={saving} onClick={saveFix}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" className="dash-filter" disabled={saving} onClick={() => setFix(null)}>Cancel</button>
              </div>
              <p className="hint" style={{ marginBottom: 0 }}>Times are Toronto time. An Out before the In means it ran past midnight.</p>
            </div>
          )}
          <p className="hint">Every shift, staff or driver, is fixed here with Fix times.</p>
        </details>
      </>)}
    </div>
  );
}
