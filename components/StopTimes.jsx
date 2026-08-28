'use client';
import { useCallback, useEffect, useState } from 'react';
import ShiftHours from './ShiftHours';

// The history of every stop, with the clock beside it: when the driver got
// there, when they finished, how long it took.
//
// It exists because the times were only ever visible one card at a time, on the
// day, and the question the office actually asks is the other shape — "what did
// Tuesday look like", "how long is Ruban taking on a white-glove", "which stops
// have no times on them at all". The last one is the important one: a stop with
// no clock cannot be costed, cannot be billed by the hour, and the pay report
// quietly counts it as zero hours.
//
// Two flags are called out rather than left to be noticed:
//   · finished with no times — nobody typed them and nobody will unless asked;
//   · clocked in, never clocked out, and the day is over — the forgotten Done
//     tap, which is the single most common thing that happens here.
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const shift = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};
const weekStart = (iso) => shift(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
const timeField = (iso) =>
  (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '');
const asDuration = (m) => (m == null ? null : (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`));
const dayLabel = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' }
];

export default function StopTimes({ drivers = [] }) {
  const t = today();
  const [range, setRange] = useState('week');
  const [from, setFrom] = useState(weekStart(t));
  const [to, setTo] = useState(t);
  const [driverId, setDriverId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);   // job id whose times are open
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f, tt, drv) => {
    setLoading(true); setErr('');
    try {
      const q = new URLSearchParams({ view: 'times', from: f, to: tt });
      if (drv) q.set('driverId', drv);
      const d = await fetch(`/api/admin/dispatch?${q}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setData(d);
    } catch { setErr('Network error — could not load the times.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(from, to, driverId); /* eslint-disable-next-line */ }, []);

  function pickRange(k) {
    setRange(k);
    if (k === 'custom') return;
    const f = k === 'today' ? t : k === 'week' ? weekStart(t) : monthStart(t);
    setFrom(f); setTo(t); load(f, t, driverId);
  }

  async function saveTimes(row, timeIn, timeOut, markDone) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'times', jobId: row.id, date: row.date, timeIn, timeOut, markDone,
          note: 'typed in from the times report'
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save those times.'); return; }
      setEditing(null);
      await load(from, to, driverId);
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(false); }
  }

  const rows = data?.rows || [];
  const withTimes = rows.filter((r) => r.minutes != null);
  const average = withTimes.length
    ? Math.round(withTimes.reduce((a, r) => a + r.minutes, 0) / withTimes.length) : null;

  return (
    <div>
      <div className="inv-search" style={{ marginBottom: 12 }}>
        {RANGES.map((r) => (
          <button key={r.key} type="button"
            className={'svc-chip' + (range === r.key ? ' is-on' : '')}
            onClick={() => pickRange(r.key)}>{r.label}</button>
        ))}
        {range === 'custom' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
            <button type="button" className="btn accent" onClick={() => load(from, to, driverId)}>Show</button>
          </>
        )}
        <select value={driverId} style={{ width: 170 }}
          onChange={(e) => { setDriverId(e.target.value); load(from, to, e.target.value); }}>
          <option value="">Everyone</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {err && <div className="error-box">{err}</div>}

      {data && (
        <>
          <div className="dash-kpis" style={{ marginBottom: 14 }}>
            <div className="kpi-card">
              <div className="kpi-value">{rows.length}</div>
              <div className="kpi-label">Stops in this period</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{asDuration(average) || '—'}</div>
              <div className="kpi-label">Average time on site</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{data.missing}</div>
              <div className="kpi-label">
                Finished with no usable times
                {data.bad > 0 && ` · ${data.bad} clock${data.bad === 1 ? '' : 's'} to correct`}
              </div>
            </div>
          </div>

          {data.stuck > 0 && (
            <div className="error-box">
              {data.stuck} stop{data.stuck === 1 ? '' : 's'} {data.stuck === 1 ? 'was' : 'were'} clocked in and never
              clocked out. Put the real finish time in below — the drivers post them in the group chat — rather than
              closing the stop out now, which would record every hour since as time on site.
            </div>
          )}

          <ShiftHours from={data.from} to={data.to} drivers={drivers} />

          <div className="panel">
            <p className="hint" style={{ marginTop: 0 }}>
              {data.from} to {data.to}. <b>Got there</b> is the driver&apos;s Arrived tap and <b>finished</b> is their
              Done tap; either can be corrected here, and a correction is written to the stop&apos;s history with your
              name on it.
            </p>
            <div className="table-wrap"><table className="admin">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Stop</th>
                  <th>Driver</th>
                  <th>Window</th>
                  <th>Got there</th>
                  <th>Finished</th>
                  <th style={{ textAlign: 'right' }}>On site</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={8} style={{ color: 'var(--muted)' }}>No stops in that period.</td></tr>
                )}
                {!loading && rows.map((r) => (
                  <tr key={r.id} className={r.stuckOpen || r.badTimes ? 'is-warn' : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.date ? dayLabel(r.date) : '—'}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.customerName || '(no name)'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        {r.jobNumber}{r.orderNumber ? ` · ${r.orderNumber}` : ''}
                        {r.clientName ? ` · ${r.clientName}` : ''}
                        {r.where ? ` · ${r.where}` : ''}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.driverName || '—'}
                      {r.mateName && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>+ {r.mateName}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                      {r.windowStart && r.windowEnd ? `${r.windowStart}–${r.windowEnd}` : 'Any time'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{hhmm(r.timeIn) || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {hhmm(r.timeOut) || (r.stuckOpen
                        ? <span className="disp-late">never clocked out</span>
                        : '—')}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {/* A stop that took zero minutes, or finished before it
                          started, is a clock to correct — not a duration. Both
                          are real on this data: a close-out that happened before
                          the times were stamped by the taps wrote in and out at
                          the same instant. */}
                      {r.badTimes
                        ? <span className="disp-late">{r.minutes < 0 ? 'ends before it starts' : 'no time on it'}</span>
                        : (asDuration(r.minutes) || '—')}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="disp-toggle" disabled={busy}
                        onClick={() => setEditing(editing === r.id ? null : r.id)}>
                        {editing === r.id ? 'cancel' : 'fix'}
                      </button>
                      {editing === r.id && <TimeEdit row={r} busy={busy} onSave={saveTimes} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

function TimeEdit({ row, busy, onSave }) {
  const [timeIn, setTimeIn] = useState(timeField(row.timeIn));
  const [timeOut, setTimeOut] = useState(timeField(row.timeOut));
  // A stop still open is the case this whole screen exists for, so closing it
  // out is ticked by default — and it closes at the time TYPED, never at the
  // moment somebody in the office happened to notice.
  const open = !['done', 'failed', 'cancelled'].includes(row.status);
  const [markDone, setMarkDone] = useState(open);
  return (
    <form className="disp-times-form" style={{ marginTop: 6 }}
      onSubmit={(e) => { e.preventDefault(); onSave(row, timeIn, timeOut, open && markDone); }}>
      <label>Got there<input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} /></label>
      <label>Finished<input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></label>
      {open && (
        <label className="disp-times-close">
          <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
          and mark it done
        </label>
      )}
      <button type="submit" className="btn accent" disabled={busy}>Save</button>
    </form>
  );
}
