'use client';
import { useCallback, useEffect, useState } from 'react';

// Shift hours — the day around the stops.
//
// Deliberately NOT the same number as the pay report's "hours on site". A driver
// is on shift from picking the van up to parking it; time on site is the minutes
// spent at customers' doors. Adding them together would double-count, and using
// either one as the other is wrong in a different direction each way.
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
const asDuration = (m) => (m == null ? null : (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`));
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

// `driverId` is passed through because the panel sits UNDER the Times filters
// and looked like it obeyed them. It never did: the stops table filtered to one
// driver and the shifts below carried on showing everyone, so "Kowsi's hours"
// was a number for the whole crew sitting directly beneath his name.
const timeField = (iso) =>
  (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '');

export default function ShiftHours({ from, to, driverId = '', drivers = [] }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);   // { id, startTime, endTime, startKm, endKm, vehicleId }
  const [busy, setBusy] = useState(false);
  const [vans, setVans] = useState([]);
  useEffect(() => {
    fetch('/api/admin/dispatch?view=vehicles')
      .then((r) => r.json()).then((d) => setVans(d.vehicles || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ view: 'shifts', from, to });
      if (driverId) q.set('driverId', driverId);
      const d = await fetch(`/api/admin/dispatch?${q}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setErr(''); setData(d);
    } catch { setErr('Could not load shifts.'); }
  }, [from, to, driverId]);
  useEffect(() => { load(); }, [load]);

  // Correcting what the taps got wrong. The report refuses to cost a shift
  // nobody closed and says "fix them in Times" — this is where that happens.
  async function save(row) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'shift_times', shiftId: row.id,
          startTime: editing.startTime, endTime: editing.endTime,
          startKm: editing.startKm, endKm: editing.endKm,
          vehicleId: editing.vehicleId, clearKm: !!editing.clearKm,
          note: 'hours corrected from the Times tab'
        })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save that shift.'); return; }
      setEditing(null);
      await load();
    } catch { setErr('Network error — nothing was saved.'); }
    finally { setBusy(false); }
  }

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return null;
  const t = data.totals || {};

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Shifts</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        {t.shifts || 0} shift{t.shifts === 1 ? '' : 's'} · <b>{t.hours || 0}h</b> clocked
        {t.km > 0 && <> · <b>{t.km.toLocaleString('en-CA')} km</b> driven</>}
        {t.open > 0 && <> · <span className="disp-late">{t.open} still open</span></>}
        {' — '}this is time <b>on shift</b>, which is not the Pay tab&apos;s time <b>on site</b>. One is what
        somebody is paid for, the other is what a delivery costs.
      </p>
      {data.rows.length === 0
        ? <p className="hint">Nobody clocked on in this period.</p>
        : (
          <div className="table-wrap"><table className="admin">
            <thead>
              <tr>
                <th>Day</th><th>Driver</th><th>Van</th>
                <th>On</th><th>Off</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
                <th style={{ textAlign: 'right' }}>Km</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={!r.endedAt ? 'is-warn' : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.startedAt ? dayLabel(r.startedAt.slice(0, 10)) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{r.driverName || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>
                    {r.driving === false
                      ? `riding${r.ridingWithName ? ` with ${r.ridingWithName}` : ''}`
                      : (r.vehicleName || '—')}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{hhmm(r.startedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.endedAt ? hhmm(r.endedAt) : <span className="disp-late">still on</span>}
                  </td>
                  <td style={{
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: r.needsFixing ? 'var(--danger, #c0392b)' : undefined,
                    fontWeight: r.needsFixing ? 700 : undefined
                  }}>
                    {asDuration(r.minutes) || '—'}
                    {r.needsFixing && (
                      <div style={{ fontSize: 11, fontWeight: 400 }}>not costed</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.km != null ? r.km.toLocaleString('en-CA') : (
                      <span style={{ color: 'var(--muted)' }}
                        title={r.driving === false
                          ? 'riding with someone — no van, no odometer'
                          : 'needs an odometer reading at both ends'}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="disp-toggle" disabled={busy}
                      onClick={() => setEditing(editing?.id === r.id ? null : {
                        id: r.id,
                        startTime: timeField(r.startedAt),
                        // Pre-filled with what the stops say, when there is
                        // nothing on the clock. The office is retyping a number
                        // it would otherwise go hunting for one tab away.
                        endTime: timeField(r.endedAt) || (r.lastStop ? timeField(r.lastStop.at) : ''),
                        startKm: r.startKm == null ? '' : String(r.startKm),
                        endKm: r.endKm == null ? '' : String(r.endKm),
                        vehicleId: r.vehicleId == null ? '' : String(r.vehicleId),
                        clearKm: false
                      })}>
                      {editing?.id === r.id ? 'close' : 'fix hours'}
                    </button>
                  </td>
                </tr>
              ))}
              {data.rows.map((r) => (editing?.id === r.id ? (
                <tr key={`edit${r.id}`}>
                  <td colSpan={8}>
                    <div className="disp-setup-form">
                      <label style={{ display: 'grid', fontSize: 12 }}>On
                        <input value={editing.startTime} placeholder="08:50" style={{ width: 110 }}
                          onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} />
                      </label>
                      <label style={{ display: 'grid', fontSize: 12 }}>Off
                        <input value={editing.endTime} placeholder="19:30" style={{ width: 110 }}
                          onChange={(e) => setEditing({ ...editing, endTime: e.target.value })} />
                      </label>
                      {r.driving !== false && (
                        <>
                          {/* The van, because the mistake this whole guard
                              exists to catch is a reading typed against the
                              wrong truck — and leaving it there poisons that
                              truck's history for everyone after. */}
                          <label style={{ display: 'grid', fontSize: 12 }}>Van
                            <select value={editing.vehicleId} style={{ width: 190 }}
                              onChange={(e) => setEditing({ ...editing, vehicleId: e.target.value })}>
                              <option value="">No van recorded</option>
                              {vans.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          </label>
                          <label style={{ display: 'grid', fontSize: 12 }}>Km on
                            <input value={editing.startKm} inputMode="numeric" style={{ width: 120 }}
                              onChange={(e) => setEditing({ ...editing, startKm: e.target.value.replace(/\D+/g, '') })} />
                          </label>
                          <label style={{ display: 'grid', fontSize: 12 }}>Km off
                            <input value={editing.endKm} inputMode="numeric" style={{ width: 120 }}
                              onChange={(e) => setEditing({ ...editing, endKm: e.target.value.replace(/\D+/g, '') })} />
                          </label>
                        </>
                      )}
                      {r.driving !== false && (
                        <label style={{ fontSize: 12, alignSelf: 'end', whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={!!editing.clearKm}
                            onChange={(e) => setEditing({ ...editing, clearKm: e.target.checked })} />
                          {' '}Clear both readings
                        </label>
                      )}
                      <button type="button" className="btn accent" disabled={busy} onClick={() => save(r)}>
                        {busy ? 'Saving…' : 'Save hours'}
                      </button>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                      <p className="hint" style={{ flexBasis: '100%', margin: 0 }}>
                        24-hour, on {r.startedAt ? dayLabel(r.startedAt.slice(0, 10)) : 'the shift’s own day'}. An Off
                        before the On is taken as past midnight.
                        {r.lastStop && (
                          <> The last thing {r.driverName} finished that day was <b>{r.lastStop.what}</b> at{' '}
                            <b>{hhmm(r.lastStop.at)}</b>
                            {r.lastStop.type === 'return_to_base'
                              ? ' — that is the van being parked, so it is the finish time.'
                              : ' — the real finish is after that, plus the drive back.'}
                          </>
                        )}
                        {' '}A reading that belongs to no van at all — a 0, or a stray six-figure number — should be
                        <b> cleared</b> rather than guessed at: the next real reading on that truck becomes its
                        baseline again.
                        {r.editedBy && <> Last corrected by {r.editedBy}.</>}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null))}
            </tbody>
          </table></div>
        )}
    </div>
  );
}
