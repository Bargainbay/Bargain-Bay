'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' };
const toLocal = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const day = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const CO = { bargain_bay: 'Bargain Bay', rs_solutions: 'RS Solutions' };
const coName = (c) => CO[c] || 'Unassigned';
const hm = (m) => (m == null ? 'open' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

// Admin: who may clock in (and at what rate), and the hours they've logged.
export default function TeamClockAdmin({ employees, shifts, from, to }) {
  const router = useRouter();
  const [emp, setEmp] = useState({ email: '', name: '', roleLabel: '', hourlyRate: '', company: '' });
  const [fix, setFix] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send(body, after) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/team-clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      after?.(); router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const done = shifts.filter((x) => x.minutes != null);
  const byCo = ['bargain_bay', 'rs_solutions', null].map((c) => {
    const rows = shifts.filter((x) => (x.company || null) === c);
    return { c, people: new Set(rows.map((x) => x.employeeId)).size, mins: rows.reduce((a, x) => a + (x.minutes || 0), 0), open: rows.filter((x) => x.minutes == null).length };
  }).filter((r) => r.people || r.c);
  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Team clock</h1>
      <p className="hint">
        Add someone by email. They sign up at <b>/signup</b> with that address (or already have an account),
        then open the clock page on their phone and tap Clock in / Clock out. Save it to their home screen.
        <a href="/clock" style={{ marginLeft: 6 }}>Open the employee clock page →</a>
        Drivers keep using the driver app. Don&apos;t add a driver here too, or their hours count twice.
      </p>

      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th style={{ textAlign: 'right' }}>$/hour</th><th></th></tr></thead>
        <tbody>
          {employees.length === 0 && <tr><td colSpan={6} className="hint">No employees yet.</td></tr>}
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.name || '—'}</td><td>{e.email}</td><td>{coName(e.company)}</td><td>{e.roleLabel || '—'}</td>
              <td style={{ textAlign: 'right' }}>{e.hourlyRate == null ? <b style={{ color: 'var(--danger)' }}>not set</b> : e.hourlyRate.toFixed(2)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="dash-filter" onClick={() => setEmp({ email: e.email, name: e.name || '', roleLabel: e.roleLabel || '', hourlyRate: e.hourlyRate ?? '', company: e.company || '' })}>Edit</button>{' '}
                <button type="button" className="dash-filter" disabled={busy} onClick={() => { if (confirm(`Remove ${e.name || e.email}? Their past hours stay.`)) send({ action: 'end_employee', id: e.id }); }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        <input style={{ ...input, width: 210 }} placeholder="Email" value={emp.email} onChange={(e) => setEmp({ ...emp, email: e.target.value })} />
        <input style={{ ...input, width: 150 }} placeholder="Name" value={emp.name} onChange={(e) => setEmp({ ...emp, name: e.target.value })} />
        <select style={{ ...input, width: 140 }} value={emp.company} onChange={(e) => setEmp({ ...emp, company: e.target.value })}>
          <option value="">Company…</option><option value="bargain_bay">Bargain Bay</option><option value="rs_solutions">RS Solutions</option>
        </select>
        <input style={{ ...input, width: 140 }} placeholder="Role (warehouse…)" value={emp.roleLabel} onChange={(e) => setEmp({ ...emp, roleLabel: e.target.value })} />
        <input style={{ ...input, width: 100 }} type="number" min="0" step="0.25" inputMode="decimal" placeholder="$/hour" value={emp.hourlyRate} onChange={(e) => setEmp({ ...emp, hourlyRate: e.target.value })} />
        <button type="button" className="dash-filter active" disabled={busy} onClick={() => send({ action: 'save_employee', ...emp }, () => setEmp({ email: '', name: '', roleLabel: '', hourlyRate: '', company: '' }))}>Save employee</button>
      </div>
      <p className="hint">A rate change applies to shifts started from now on; past shifts keep the rate they had.</p>
      {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}

      <h2 style={{ color: 'var(--charcoal)' }}>Hours</h2>
      <form style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <label>From <input type="date" name="from" defaultValue={from} /></label>
        <label>To <input type="date" name="to" defaultValue={to} /></label>
        <button className="dash-filter active" type="submit">Show</button>
      </form>
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Company</th><th>People</th><th style={{ textAlign: 'right' }}>Hours</th><th>Still in</th></tr></thead>
        <tbody>
          {byCo.map((r) => (<tr key={r.c || 'none'}><td>{coName(r.c)}</td><td>{r.people}</td><td style={{ textAlign: 'right' }}>{hm(r.mins)}</td><td>{r.open || '—'}</td></tr>))}
          <tr><td><b>Both companies</b></td><td>{new Set(shifts.map((x) => x.employeeId)).size}</td><td style={{ textAlign: 'right' }}><b>{hm(done.reduce((a, x) => a + x.minutes, 0))}</b></td><td>{shifts.length - done.length || '—'}</td></tr>
        </tbody>
      </table></div>
      <div className="table-wrap" style={{ marginTop: 12 }}><table className="admin">
        <thead><tr><th>Day</th><th>Who</th><th>Company</th><th>In</th><th>Out</th><th style={{ textAlign: 'right' }}>Time</th><th style={{ textAlign: 'right' }}>Rate</th><th></th></tr></thead>
        <tbody>
          {shifts.length === 0 && <tr><td colSpan={8} className="hint">No shifts in this range.</td></tr>}
          {shifts.map((s) => (
            <tr key={s.id}>
              <td>{day(s.startedAt)}</td><td>{s.name}</td><td>{coName(s.company)}</td>
              <td>{toLocal(s.startedAt)}</td>
              <td>{s.endedAt ? toLocal(s.endedAt) : <b style={{ color: 'var(--warn)' }}>still in</b>}</td>
              <td style={{ textAlign: 'right' }}>{hm(s.minutes)}</td>
              <td style={{ textAlign: 'right' }}>{s.rate == null ? '—' : s.rate.toFixed(2)}</td>
              <td><button type="button" className="dash-filter" onClick={() => setFix({ id: s.id, date: day(s.startedAt), start: toLocal(s.startedAt), end: toLocal(s.endedAt) })}>Fix times</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {fix && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Fix shift</b>
          <input style={input} type="date" value={fix.date} onChange={(e) => setFix({ ...fix, date: e.target.value })} />
          <label>In <input style={input} type="time" value={fix.start} onChange={(e) => setFix({ ...fix, start: e.target.value })} /></label>
          <label>Out <input style={input} type="time" value={fix.end} onChange={(e) => setFix({ ...fix, end: e.target.value })} /></label>
          <button type="button" className="dash-filter active" disabled={busy} onClick={() => send({ action: 'fix_shift', ...fix }, () => setFix(null))}>Save</button>
          <button type="button" className="dash-filter" onClick={() => setFix(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
