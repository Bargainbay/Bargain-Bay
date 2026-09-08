'use client';
import { useCallback, useEffect, useState } from 'react';

// Loose ends: every stop whose day has been and gone that nobody ever closed.
//
// They have always existed and there has never been anywhere to look at them.
// The board is one day at a time, so last Tuesday's forgotten delivery is only
// visible to somebody who already knows to go back to Tuesday — and nobody goes
// looking for work they have forgotten about. The DRIVER'S phone was carrying
// them instead, all of them, stacked above this morning's first delivery. Taking
// them off that screen is only half an answer if the office still can't see them.
//
// Deliberately not a "clear all" button. Each row is a different question with a
// different answer — it happened and nobody tapped Done, it never happened, it
// is still owed to a customer, it should never have been raised — and a sweep
// that closed them in bulk would erase the one thing the list is for: which of
// these is still somebody's appliance, and which is somebody's cash.
const FAIL_REASONS = {
  no_answer: 'Nobody home', refused: 'Customer refused', wrong_address: 'Wrong / bad address',
  no_access: "Wouldn't fit / no access", damaged: 'Item damaged',
  rescheduled: 'Customer rescheduled', other: 'Other'
};

const STATUS_LABEL = {
  unscheduled: 'Unscheduled', scheduled: 'Scheduled', on_the_way: 'On the way', arrived: 'Arrived'
};

const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const dayLabel = (iso) =>
  (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '—');
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
// What a driver would type: 24-hour, on the stop's own day.
const timeField = (iso) =>
  (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '');

export default function StaleStops({ onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(null);   // the row being closed out
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const d = await fetch('/api/admin/dispatch?view=stale', { cache: 'no-store' }).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setData(d);
    } catch { setErr('Network error — could not load the list.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function send(body, failNote) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || failNote || 'That didn’t work.'); return false; }
      setClosing(null);
      await load();
      onChanged?.();
      return true;
    } catch {
      setErr('Network error — nothing was changed.'); return false;
    } finally { setBusy(false); }
  }

  // Closed out with the times it ACTUALLY took. Closing it "now" would record a
  // two-hour delivery from last Tuesday as a six-day one and wreck every cost
  // figure built on top of it — which is exactly what the office had to do
  // before there was anywhere to type the real times.
  function openCloseOut(r) {
    setClosing(r.id);
    setTimeIn(timeField(r.timeIn));
    setTimeOut(timeField(r.timeOut));
    setErr('');
  }

  function closeOut(r) {
    if (!timeIn || !timeOut) { setErr('Put both times in — that is the whole point of closing it here.'); return; }
    send({
      action: 'times', jobId: r.id, date: r.date, timeIn, timeOut, markDone: true,
      note: 'closed out from loose ends'
    }, 'Could not close that stop.');
  }

  function couldNot(r) {
    const keys = Object.keys(FAIL_REASONS);
    const answer = window.prompt(
      `Why didn't ${r.jobNumber} happen?\n${keys.map((k, i) => `${i + 1}. ${FAIL_REASONS[k]}`).join('\n')}\n\nEnter a number:`
    );
    const pick = keys[Number(answer) - 1];
    if (!pick) return;
    const note = window.prompt('Anything to add? (optional)') || '';
    send({ action: 'status', jobId: r.id, status: 'failed', failReason: pick, note }, 'Could not update that stop.');
  }

  function moveToToday(r) {
    if (!window.confirm(`Put ${r.jobNumber} on today's board? It keeps its driver and everything on it.`)) return;
    send({ action: 'assign', jobId: r.id, jobDate: data.today }, 'Could not move that stop.');
  }

  function cancel(r) {
    const reason = window.prompt(`Cancel ${r.jobNumber}? Add a short reason:`);
    if (reason === null) return;
    send({ action: 'cancel', jobId: r.id, reason }, 'Could not cancel that stop.');
  }

  const rows = data?.rows || [];
  const running = rows.filter((r) => r.timeIn && !r.timeOut);
  const reported = rows.filter((r) => r.reported > 0);

  return (
    <div>
      {err && <div className="error-box">{err}</div>}

      {data && (
        <div className="dash-kpis" style={{ marginBottom: 14 }}>
          <div className="kpi-card">
            <div className="kpi-value">{rows.length}{data.capped ? '+' : ''}</div>
            <div className="kpi-label">
              Stops never closed
              {data.oldest ? ` · oldest ${dayLabel(data.oldest)}` : ''}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{running.length}</div>
            <div className="kpi-label">Clocked in, never clocked out</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{money(data.owing)}</div>
            <div className="kpi-label">Still owing on them</div>
          </div>
        </div>
      )}

      {data?.capped && (
        <div className="error-box">
          Only the oldest {rows.length} are listed. Work through these and the rest will follow — a truncated
          list of things nobody has dealt with reads exactly like a complete one, so it says so here.
        </div>
      )}

      {reported.length > 0 && (
        <div className="error-box">
          {reported.length === 1 ? 'One of these has' : `${reported.length} of these have`} money a driver
          says they collected sitting against {reported.length === 1 ? 'it' : 'them'}. That is cash somebody is
          holding — confirm it on the board before you close the stop.
        </div>
      )}

      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>
          Stops whose day has gone that were never finished, oldest first. Most of these are a forgotten Done
          tap — close those out with <b>the real times</b>, which the drivers post in the group chat, rather than
          closing them at whatever time you happened to look. A stop that genuinely never happened is
          <b> Couldn&apos;t complete</b>; one the customer is still waiting for goes back on <b>today&apos;s board</b>.
          Every one of these is written to the stop&apos;s own history with your name on it.
        </p>
        <div className="table-wrap"><table className="admin">
          <thead>
            <tr>
              <th>Day</th>
              <th>Stop</th>
              <th>Driver</th>
              <th>What&apos;s on it</th>
              <th style={{ textAlign: 'right' }}>Owing</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>
                Nothing loose. Every stop before today has been closed one way or another.
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className={r.reported > 0 || r.timeIn ? 'is-warn' : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {dayLabel(r.date)}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {r.daysAgo === 1 ? 'yesterday' : `${r.daysAgo} days ago`}
                  </div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.customerName || '(no name)'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {r.jobNumber}{r.orderNumber ? ` · ${r.orderNumber}` : ''}
                    {r.clientName ? ` · ${r.clientName}` : ''}
                    {r.where ? ` · ${r.where}` : ''}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.driverName || <span style={{ color: 'var(--muted)' }}>nobody</span>}
                  {r.mateName && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>+ {r.mateName}</div>}
                </td>
                <td style={{ fontSize: 12 }}>
                  <span className="pill warn">{STATUS_LABEL[r.status] || r.status}</span>
                  {/* The clock is the loudest evidence of what actually happened:
                      clocked in and never out is a stop somebody DID. */}
                  {r.timeIn && (
                    <div style={{ marginTop: 3 }}>
                      on site since {hhmm(r.timeIn)}{r.timeOut ? ` · left ${hhmm(r.timeOut)}` : ' — never clocked out'}
                    </div>
                  )}
                  {(r.hasSignature || r.photoCount > 0) && (
                    <div style={{ marginTop: 3 }}>
                      {r.hasSignature ? 'signed' : ''}{r.hasSignature && r.photoCount ? ' · ' : ''}
                      {r.photoCount ? `${r.photoCount} photo${r.photoCount === 1 ? '' : 's'}` : ''}
                      {' — it happened.'}
                    </div>
                  )}
                  {r.reported > 0 && (
                    <div style={{ marginTop: 3, fontWeight: 700 }}>
                      {money(r.reported)} reported collected — confirm it before closing this
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.balanceDue > 0 ? money(r.balanceDue) : '—'}
                  {r.invoiceNumber && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.invoiceNumber}</div>
                  )}
                </td>
                <td>
                  {closing === r.id ? (
                    <div className="stale-close">
                      <label>
                        Got there
                        <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} />
                      </label>
                      <label>
                        Finished
                        <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} />
                      </label>
                      <button type="button" className="btn accent" disabled={busy} onClick={() => closeOut(r)}>
                        {busy ? '…' : 'Close it out'}
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => setClosing(null)}>Cancel</button>
                      <span className="hint" style={{ margin: 0, width: '100%' }}>
                        The times it really took, on {dayLabel(r.date)} — not now.
                      </span>
                    </div>
                  ) : (
                    <div className="stale-acts">
                      <button type="button" className="btn accent" disabled={busy} onClick={() => openCloseOut(r)}>
                        It was done
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => moveToToday(r)}>
                        Move to today
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => couldNot(r)}>
                        Couldn&apos;t complete
                      </button>
                      <button type="button" className="stale-cancel" disabled={busy} onClick={() => cancel(r)}>
                        Cancel it
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
