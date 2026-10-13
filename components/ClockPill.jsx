'use client';
import { useEffect, useState } from 'react';

// The clock, in the portal's top bar, for anybody on the team list. Green
// "Clock in" to start, red "Clock out · since 9:02" to stop -- the same button
// RS Ops shows its crew. It renders NOTHING for anyone who is not an employee
// (the owner, a coordinator), so it can sit in the shared nav without clutter,
// and nobody ever has to type an address to find it.
export default function ClockPill({ alone = false }) {
  const [st, setSt] = useState(null);   // { shift, question } once we know they're an employee
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => fetch('/api/clock', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSt(d && !d.error ? d : null))
      .catch(() => {});
    load();
    const t = setInterval(load, 60000);   // the evening "still working?" arrives on its own
    return () => clearInterval(t);
  }, []);
  if (!st?.employee) return null;

  const since = st.shift && new Date(st.shift.startedAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
  async function send(body) {
    setBusy(true);
    try {
      const r = await fetch('/api/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      // A refusal ("you're still on the driver app") is what they need to read.
      if (!r.ok) throw new Error(d.error || 'That didn\'t save — try again.');
      setSt((s) => ({ ...s, shift: d.shift || null, question: null }));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  }
  const tap = () => {
    if (st.shift && !confirm('Clock out now?')) return;
    send({ action: st.shift ? 'out' : 'in' });
  };
  const btn = { border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 13, color: '#fff', cursor: 'pointer' };
  return (
    <>
      <button type="button" onClick={tap} disabled={busy} style={{ ...btn, background: st.shift ? '#b3261e' : '#1a7f37', marginLeft: alone ? 'auto' : 4 }}>
        {st.shift ? `Clock out · since ${since}` : 'Clock in'}
      </button>
      {st.shift && st.question && (
        <div role="alertdialog" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', color: '#222', borderRadius: 14, padding: 22, maxWidth: 340, width: '100%', textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 6px' }}>Still working?</h2>
            <p style={{ margin: '0 0 16px', fontSize: 14 }}>You&apos;ve been clocked in since {since}.</p>
            <button type="button" disabled={busy} onClick={() => send({ action: 'answer', answer: 'yes' })}
              style={{ ...btn, background: '#1a7f37', width: '100%', padding: 14, fontSize: 17, marginBottom: 8 }}>Yes, still working</button>
            <button type="button" disabled={busy} onClick={() => send({ action: 'answer', answer: 'no' })}
              style={{ ...btn, background: '#b3261e', width: '100%', padding: 14, fontSize: 17 }}>No — clock me out</button>
          </div>
        </div>
      )}
    </>
  );
}
