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

export default function ShiftHours({ from, to, drivers = [] }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/admin/dispatch?view=shifts&from=${from}&to=${to}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setErr(''); setData(d);
    } catch { setErr('Could not load shifts.'); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

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
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={!r.endedAt ? 'is-warn' : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.startedAt ? dayLabel(r.startedAt.slice(0, 10)) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{r.driverName || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.vehicleName || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{hhmm(r.startedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.endedAt ? hhmm(r.endedAt) : <span className="disp-late">still on</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{asDuration(r.minutes) || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.km != null ? r.km.toLocaleString('en-CA') : (
                      <span title="needs an odometer reading at both ends" style={{ color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
    </div>
  );
}
