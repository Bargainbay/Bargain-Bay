'use client';
import { useEffect, useState } from 'react';

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const hm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

// One big button. Shows whether you are clocked in, since when, and your last
// few shifts so a missed clock-out is obvious to the person who missed it.
export default function ClockButton({ name }) {
  const [shift, setShift] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    fetch('/api/clock').then((r) => r.json()).then((d) => {
      if (d.error) setErr(d.error); else { setShift(d.shift); setRecent(d.recent || []); }
      setLoaded(true);
    }).catch(() => { setErr('No signal -- try again in a moment.'); setLoaded(true); });
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  async function go(action) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That didn\'t work.');
      setShift(action === 'in' ? d.shift : null);
      setRecent(d.recent || []);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const running = shift ? Math.max(0, Math.round((Date.now() - new Date(shift.startedAt)) / 60000)) : 0;
  return (
    <>
      <div className="drv-card">
        <h1 className="drv-hello" style={{ marginTop: 0 }}>Hi {String(name).split(' ')[0]}</h1>
        {!loaded ? <p className="hint">Loading…</p> : shift ? (
          <>
            <p style={{ fontSize: 17, margin: '4px 0 12px' }}>
              Clocked in since <b>{fmtTime(shift.startedAt)}</b> · {hm(running)} so far
            </p>
            <button type="button" className="drv-btn done" disabled={busy} onClick={() => go('out')}>
              {busy ? 'Clocking out…' : 'Clock out'}
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 17, margin: '4px 0 12px' }}>You&apos;re clocked out.</p>
            <button type="button" className="drv-btn go" style={{ width: '100%', minHeight: 58, fontSize: 18 }} disabled={busy} onClick={() => go('in')}>
              {busy ? 'Clocking in…' : 'Clock in'}
            </button>
          </>
        )}
        {err && <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 0 }}>{err}</p>}
      </div>
      {recent.length > 0 && (
        <div className="drv-card">
          <h2 className="drv-hello" style={{ marginTop: 0, fontSize: 15 }}>Recent shifts</h2>
          {recent.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
              <span>{fmtDay(s.startedAt)} · {fmtTime(s.startedAt)}–{s.endedAt ? fmtTime(s.endedAt) : 'now'}</span>
              <b>{s.minutes != null ? hm(s.minutes) : 'open'}</b>
            </div>
          ))}
          <p className="hint" style={{ marginBottom: 0 }}>Forgot to clock out? Tell the office -- they can fix the time.</p>
        </div>
      )}
    </>
  );
}
