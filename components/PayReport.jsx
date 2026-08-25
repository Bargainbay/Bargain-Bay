'use client';
import { useEffect, useState } from 'react';

// What each driver and tech is owed for the work they actually finished.
// Counts COMPLETED jobs only — one that didn't happen isn't owed, and one still
// on the board isn't finished. Hours are time genuinely on site, from the time
// in / time out recorded when the job was closed out.
const money = (n) => '$' + (Number(n) || 0).toFixed(2);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

function shift(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}
// Weeks run Mon–Sun, matching the existing payroll week.
function weekStart(iso) {
  const d = new Date(`${iso}T12:00:00`);
  const back = (d.getDay() + 6) % 7;
  return shift(iso, -back);
}
function monthStart(iso) { return `${iso.slice(0, 7)}-01`; }

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' }
];

export default function PayReport({ canSetPay }) {
  const t = today();
  const [range, setRange] = useState('week');
  const [from, setFrom] = useState(weekStart(t));
  const [to, setTo] = useState(t);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load(f = from, tt = to) {
    setLoading(true); setErr('');
    try {
      const d = await fetch(`/api/admin/dispatch?view=pay&from=${f}&to=${tt}`).then((r) => r.json());
      if (d.error) { setErr(d.error); return; }
      setData(d);
    } catch { setErr('Network error — could not load the pay figures.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function pickRange(k) {
    setRange(k);
    if (k === 'custom') return;
    const f = k === 'today' ? t : k === 'week' ? weekStart(t) : monthStart(t);
    setFrom(f); setTo(t); load(f, t);
  }

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
            <button type="button" className="btn accent" onClick={() => load()}>Show</button>
          </>
        )}
      </div>

      {err && <div className="error-box">{err}</div>}

      {data && (
        <>
          <div className="dash-kpis" style={{ marginBottom: 14 }}>
            <div className="kpi-card">
              <div className="kpi-value">{money(data.total)}</div>
              <div className="kpi-label">Owed for this period</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{data.rows.reduce((a, r) => a + r.jobs, 0)}</div>
              <div className="kpi-label">Jobs completed</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{data.unpriced}</div>
              <div className="kpi-label">Still unpriced</div>
            </div>
          </div>

          {data.unpriced > 0 && (
            <div className="notice-box">
              {data.unpriced} completed job{data.unpriced === 1 ? ' has' : 's have'} no pay set, so
              the total below is short. Open the job on the board and set what it pays when you close it out.
            </div>
          )}

          <div className="panel">
            <p className="hint" style={{ marginTop: 0 }}>
              {data.from} to {data.to} · completed work only.
            </p>
            <div className="table-wrap"><table className="admin">
              <thead>
                <tr>
                  <th>Person</th>
                  <th style={{ textAlign: 'right' }}>Jobs</th>
                  <th style={{ textAlign: 'right' }}>Service calls</th>
                  <th style={{ textAlign: 'right' }}>Hours on site</th>
                  <th style={{ textAlign: 'right' }}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Loading…</td></tr>}
                {!loading && data.rows.length === 0 && (
                  <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>
                    Nothing completed in that period.
                  </td></tr>
                )}
                {!loading && data.rows.map((r) => (
                  <tr key={r.worker}>
                    <td style={{ fontWeight: 600 }}>
                      {r.worker}
                      {r.unpriced > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>
                          {r.unpriced} job{r.unpriced === 1 ? '' : 's'} unpriced
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.jobs}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.serviceCalls}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hours || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{money(r.owed)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            <p className="hint">
              This is dispatch pay only — what a job was worth, set per job when it was closed out.
              It is <b>separate from Payroll</b>, which pays shop work by piece rate and drivers a flat
              rate per Bargain Bay order delivered. If you use both for the same delivery, you&apos;ll
              count it twice.
              {!canSetPay && ' Only an admin can set what a job pays.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
