'use client';
import { useState, useEffect, useCallback } from 'react';
import { money } from '../lib/constants';

const money0 = (v) => money(Number(v) || 0);

export default function PayrollManager() {
  const [week, setWeek] = useState(0); // 0 = this week, -1 = last week …
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [rates, setRates] = useState(null);
  const [entry, setEntry] = useState({ worker: '', date: '', tested: '', cleaned: '', repaired: '', hours: '', note: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (w) => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`/api/admin/payroll?week=${w}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Load failed');
      setData(d); setRates(d.rates);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(week); }, [week, load]);

  async function post(body) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      await load(week);
      return d;
    } catch (e) { setErr(e.message); throw e; } finally { setBusy(false); }
  }

  const saveRates = () => post({ action: 'rates', rates });
  const addEntry = async () => { if (!entry.worker) { setErr('Worker name is required.'); return; } await post(entry); setEntry({ ...entry, tested: '', cleaned: '', repaired: '', hours: '', note: '' }); };
  const del = (id) => post({ action: 'delete', id });

  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13.5 };
  const report = data?.report;
  const weekLabel = week === 0 ? 'This week' : week === -1 ? 'Last week' : `${Math.abs(week)} weeks ago`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '4px 0 14px' }}>
        <h1 style={{ color: 'var(--charcoal)', margin: 0 }}>Payroll</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn" style={{ padding: '5px 10px' }} onClick={() => setWeek(week - 1)}>← Prev</button>
          <span className="hint" style={{ margin: 0, minWidth: 90, textAlign: 'center' }}>{weekLabel}</span>
          <button className="btn" style={{ padding: '5px 10px' }} disabled={week >= 0} onClick={() => setWeek(Math.min(0, week + 1))}>Next →</button>
        </div>
      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>{weekLabel} — pay owed</h2>
          <strong style={{ fontSize: 18, color: 'var(--charcoal)' }}>{report ? money0(report.total) : '—'}</strong>
        </div>
        {loading ? <p className="hint">Loading…</p> : !report || report.workers.length === 0 ? (
          <p className="hint" style={{ marginTop: 0 }}>No work logged for this week yet. Team members report on Telegram, or add an entry below.</p>
        ) : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Worker</th><th style={{ textAlign: 'right' }}>Tested</th><th style={{ textAlign: 'right' }}>Cleaned</th><th style={{ textAlign: 'right' }}>Repaired</th><th style={{ textAlign: 'right' }}>Deliveries</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Pay</th></tr></thead>
            <tbody>
              {report.workers.map((w) => (
                <tr key={w.worker}>
                  <td style={{ fontWeight: 600 }}>{w.worker}</td>
                  <td style={{ textAlign: 'right' }}>{w.tested || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{w.cleaned || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{w.repaired || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {w.deliveries || '—'}
                    {/* A delivery priced on the dispatch board is paid there, not
                        here. Saying so is what stops a short count reading as a
                        missing day's work. */}
                    {w.dispatchDeliveries > 0 && (
                      <div className="hint" style={{ margin: 0, fontSize: 11 }}>
                        +{w.dispatchDeliveries} paid on dispatch (${Number(w.dispatchPaid || 0).toFixed(2)})
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{w.hours || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money0(w.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Drivers&apos; deliveries are counted automatically from delivery records; shop work comes from
          Telegram reports / entries below. A stop that was given a price on the <b>dispatch Pay tab</b> is
          paid there and left out of this rate, so nothing is counted twice — anything without a dispatch
          price still earns the flat delivery rate here.
        </p>
      </div>

      {rates && (
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Pay rates</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[['test', 'Per tested'], ['clean', 'Per cleaned'], ['repair', 'Per repaired'], ['delivery', 'Per delivery'], ['hourly', 'Hourly (default)']].map(([k, label]) => (
              <label key={k} style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}<br />
                <span style={{ color: 'var(--muted)' }}>$ </span>
                <input type="number" min="0" step="0.01" value={rates[k] ?? 0} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} style={{ ...inp, width: 90 }} />
              </label>
            ))}
            <button className="btn primary" disabled={busy} onClick={saveRates} style={{ padding: '7px 14px' }}>Save rates</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Log work (manual)</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Worker" value={entry.worker} onChange={(e) => setEntry({ ...entry, worker: e.target.value })} style={{ ...inp, width: 130 }} />
          <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} style={{ ...inp, width: 'auto' }} />
          <input type="number" min="0" placeholder="Tested" value={entry.tested} onChange={(e) => setEntry({ ...entry, tested: e.target.value })} style={{ ...inp, width: 80 }} />
          <input type="number" min="0" placeholder="Cleaned" value={entry.cleaned} onChange={(e) => setEntry({ ...entry, cleaned: e.target.value })} style={{ ...inp, width: 80 }} />
          <input type="number" min="0" placeholder="Repaired" value={entry.repaired} onChange={(e) => setEntry({ ...entry, repaired: e.target.value })} style={{ ...inp, width: 84 }} />
          <input type="number" min="0" step="0.25" placeholder="Hours" value={entry.hours} onChange={(e) => setEntry({ ...entry, hours: e.target.value })} style={{ ...inp, width: 72 }} />
          <button className="btn primary" disabled={busy} onClick={addEntry} style={{ padding: '7px 14px' }}>Log</button>
        </div>
      </div>

      {data?.recent?.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Recent entries</h2>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Date</th><th>Worker</th><th>Work</th><th>Src</th><th /></tr></thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td><td>{r.worker}</td>
                  <td>{[r.tested && `${r.tested} tested`, r.cleaned && `${r.cleaned} cleaned`, r.repaired && `${r.repaired} repaired`, r.hours && `${r.hours}h`].filter(Boolean).join(', ') || '—'}{r.note ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div> : null}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{r.source}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" style={{ padding: '3px 8px', fontSize: 12 }} disabled={busy} onClick={() => del(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
