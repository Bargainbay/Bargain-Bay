'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' };
const toLocal = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const day = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const CO = { bargain_bay: 'Bargain Bay', rs_solutions: 'RS Solutions' };
const coName = (c) => CO[c] || 'Unassigned';
// "Name, email, company, rate" per line. Company is bb / rs (or the full name);
// rate is optional. Returns the people it understood and the lines it did not.
function parseList(text) {
  const people = [], bad = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,\t]/).map((x) => x.trim());
    const email = parts.find((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    const co = parts.map((x) => x.toLowerCase()).map((x) => (/^(bb|bargain)/.test(x) ? 'bargain_bay' : /^rs/.test(x) ? 'rs_solutions' : '')).find(Boolean) || '';
    const rate = parts.find((x) => /^\$?\d+(\.\d+)?$/.test(x));
    const name = parts.find((x) => x && x !== email && !/^\$?\d+(\.\d+)?$/.test(x) && !/^(bb|bargain|rs)/i.test(x));
    if (!email) { bad.push(line); continue; }
    people.push({ email, name: name || '', company: co, hourlyRate: rate ? rate.replace('$', '') : '' });
  }
  return { people, bad };
}
const hm = (m) => (m == null ? 'open' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

// Admin: who may clock in (and at what rate), and the hours they've logged.
export default function TeamClockAdmin({ employees, shifts, from, to, drivers = [] }) {
  const router = useRouter();
  const [emp, setEmp] = useState({ email: '', name: '', roleLabel: '', hourlyRate: '', company: '', phone: '' });
  const [fix, setFix] = useState(null);
  const [list, setList] = useState('');
  const [add, setAdd] = useState({ who: '', date: '', start: '', end: '', note: '' });
  const [addMsg, setAddMsg] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rates, setRates] = useState({}); // driver id -> typed rate

  // Drivers who are not also on the employee list: their hours live on the driver clock.
  const fold = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const driverOnly = drivers.filter((d) => !employees.some((e) =>
    fold(e.email) === fold(d.email) || (d.name && fold(e.name) === fold(d.name))));

  async function addShift() {
    setAddMsg(''); setErr('');
    const [kind, id] = add.who.split(':');
    if (!id) { setErr('Pick who worked.'); return; }
    if (!add.date || !add.start || !add.end) { setErr('Give the day, the start time and the finish time.'); return; }
    const done = () => {
      setAddMsg('Shift added.');
      setAdd({ who: add.who, date: '', start: '', end: '', note: '' });
      window.dispatchEvent(new Event('rs-hours-changed'));
    };
    if (kind === 'staff') { await send({ action: 'add_shift', employeeId: id, date: add.date, start: add.start, end: add.end, note: add.note }, done); return; }
    setBusy(true);
    try {
      // Hours only (no van or odometer); Fix times can correct it afterwards.
      const r = await fetch('/api/admin/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'shift_create', driverId: id, date: add.date, startTime: add.start, endTime: add.end, driving: false, note: add.note || 'Added by the office' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      done(); router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function send(body, after) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/team-clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      after?.(); router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // A driver's or assistant's hourly rate lives on their account; the same call the Dispatch roster uses.
  async function saveDriverRate(d) {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'driver_rate', driverId: d.id, hourlyRate: rates[d.id] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setRates((x) => { const n = { ...x }; delete n[d.id]; return n; });
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const done = shifts.filter((x) => x.minutes != null);
  const byCo = ['bargain_bay', 'rs_solutions', null].map((c) => {
    const rows = shifts.filter((x) => (x.company || null) === c);
    return { c, people: new Set(rows.map((x) => x.employeeId)).size, mins: rows.reduce((a, x) => a + (x.minutes || 0), 0), open: rows.filter((x) => x.minutes == null).length };
  }).filter((r) => r.people || r.c);
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>People and hours</h2>
      <p className="hint">
        Add someone by email. They sign up at <b>/signup</b> with that address (or already have an account),
        then open the clock page on their phone and tap Clock in / Clock out. Save it to their home screen.
        <a href="/clock" style={{ marginLeft: 6 }}>Open the employee clock page →</a>
        Drivers and ride-along assistants are added in Dispatch, clock in on the driver app, and appear in the second table below
        as soon as they are created: set their hourly rate there. Don&apos;t add a driver here too, or their hours count twice.
      </p>

      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th>WhatsApp</th><th style={{ textAlign: 'right' }}>$/hour</th><th></th></tr></thead>
        <tbody>
          {employees.length === 0 && <tr><td colSpan={7} className="hint">No employees yet.</td></tr>}
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.name || '—'}</td><td>{e.email}</td><td>{coName(e.company)}</td><td>{e.roleLabel || '—'}</td><td>{e.phone || <span className="hint">from their account</span>}</td>
              <td style={{ textAlign: 'right' }}>{e.hourlyRate == null ? <b style={{ color: 'var(--danger)' }}>not set</b> : e.hourlyRate.toFixed(2)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="dash-filter" onClick={() => setEmp({ email: e.email, name: e.name || '', roleLabel: e.roleLabel || '', hourlyRate: e.hourlyRate ?? '', company: e.company || '', phone: e.phone || '' })}>Edit</button>{' '}
                <button type="button" className="dash-filter" disabled={busy} onClick={() => { if (confirm(`Remove ${e.name || e.email}? Their past hours stay.`)) send({ action: 'end_employee', id: e.id }); }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <h3 style={{ margin: '16px 0 6px', color: 'var(--charcoal)' }}>Drivers and assistants</h3>
      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Name</th><th>Phone</th><th style={{ textAlign: 'right' }}>$/hour</th><th></th></tr></thead>
        <tbody>
          {drivers.length === 0 && <tr><td colSpan={4} className="hint">No drivers or assistants yet. Add them in Dispatch → People &amp; access.</td></tr>}
          {drivers.map((d) => {
            const typed = rates[d.id];
            return (
              <tr key={d.id}>
                <td>{d.name || d.email}{d.paidAsOwner && <span className="hint"> · paid as owner (hours not costed)</span>}</td>
                <td>{d.phone || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <input style={{ ...input, width: 90 }} type="number" min="0" step="0.25" inputMode="decimal"
                    placeholder={d.hourlyRate == null ? 'not set' : ''}
                    value={typed !== undefined ? typed : (d.hourlyRate == null ? '' : d.hourlyRate)}
                    onChange={(e) => setRates({ ...rates, [d.id]: e.target.value })} />
                </td>
                <td><button type="button" className="dash-filter active" disabled={busy || typed === undefined} onClick={() => saveDriverRate(d)}>Save rate</button></td>
              </tr>);
          })}
        </tbody>
      </table></div>
      <p className="hint">A driver&apos;s rate applies to all of their hours, including shifts already clocked.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        <input style={{ ...input, width: 210 }} placeholder="Email" value={emp.email} onChange={(e) => setEmp({ ...emp, email: e.target.value })} />
        <input style={{ ...input, width: 150 }} placeholder="Name" value={emp.name} onChange={(e) => setEmp({ ...emp, name: e.target.value })} />
        <select style={{ ...input, width: 140 }} value={emp.company} onChange={(e) => setEmp({ ...emp, company: e.target.value })}>
          <option value="">Company…</option><option value="bargain_bay">Bargain Bay</option><option value="rs_solutions">RS Solutions</option>
        </select>
        <input style={{ ...input, width: 140 }} placeholder="Role (warehouse…)" value={emp.roleLabel} onChange={(e) => setEmp({ ...emp, roleLabel: e.target.value })} />
        <input style={{ ...input, width: 140 }} inputMode="tel" placeholder="WhatsApp (optional)" value={emp.phone} onChange={(e) => setEmp({ ...emp, phone: e.target.value })} />
        <input style={{ ...input, width: 100 }} type="number" min="0" step="0.25" inputMode="decimal" placeholder="$/hour" value={emp.hourlyRate} onChange={(e) => setEmp({ ...emp, hourlyRate: e.target.value })} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }} title="Leave empty for the usual: the new rate applies to shifts started from now on.">
          also apply to shifts since <input style={{ ...input, width: 150 }} type="date" value={emp.backfillFrom || ''} onChange={(e) => setEmp({ ...emp, backfillFrom: e.target.value })} /></label>
        <button type="button" className="dash-filter active" disabled={busy} onClick={() => send({ action: 'save_employee', ...emp }, () => setEmp({ email: '', name: '', roleLabel: '', hourlyRate: '', company: '', phone: '' }))}>Save employee</button>
      </div>
      <details style={{ margin: '10px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add several people at once</summary>
        <p className="hint">One person per line: <b>name, email, company, rate</b>. Company is <b>BB</b> or <b>RS</b>; rate is optional.<br />
          Example: <code>Dinesh, dinesh@example.com, RS, 25</code></p>
        <textarea style={{ ...input, width: '100%', minHeight: 110 }} value={list} onChange={(e) => setList(e.target.value)} placeholder={'Name, email, BB or RS, rate'} />
        <div style={{ marginTop: 6 }}>
          <button type="button" className="dash-filter active" disabled={busy || !list.trim()} onClick={() => {
            const { people, bad } = parseList(list);
            if (bad.length) { setErr(`No email on: ${bad.join(' | ')}`); return; }
            send({ action: 'save_many', people }, () => { setList(''); setMsg(`Saved ${people.length}.`); });
          }}>Save all</button>
          {msg && <span className="hint" style={{ marginLeft: 8 }}>{msg}</span>}
        </div>
      </details>
      <p className="hint">A rate change applies to shifts started from now on; past shifts keep the rate they had unless you fill in &ldquo;also apply to shifts since&rdquo; (for a rate that was entered wrong).</p>
      {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}

      <h2 style={{ color: 'var(--charcoal)' }}>Hours</h2>
      <form style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <label>From <input type="date" name="from" defaultValue={from} /></label>
        <label>To <input type="date" name="to" defaultValue={to} /></label>
        <button className="dash-filter active" type="submit">Show</button>
      </form>
      <details style={{ margin: '0 0 12px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add a missed shift</summary>
        <p className="hint">For when somebody forgot to clock in and out. Times are Toronto time. It is saved at their current hourly rate and marked as added by the office.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={{ ...input, width: 170 }} value={add.who} onChange={(e) => setAdd({ ...add, who: e.target.value })}>
            <option value="">Who worked…</option>
            {employees.length > 0 && <optgroup label="Staff">
              {employees.map((e) => <option key={`s${e.id}`} value={`staff:${e.id}`}>{e.name || e.email}</option>)}
            </optgroup>}
            {driverOnly.length > 0 && <optgroup label="Drivers and assistants">
              {driverOnly.map((d) => <option key={`d${d.id}`} value={`driver:${d.id}`}>{d.name || d.email}</option>)}
            </optgroup>}
          </select>
          <input style={input} type="date" max={to} value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} />
          <label>In <input style={input} type="time" value={add.start} onChange={(e) => setAdd({ ...add, start: e.target.value })} /></label>
          <label>Out <input style={input} type="time" value={add.end} onChange={(e) => setAdd({ ...add, end: e.target.value })} /></label>
          <input style={{ ...input, width: 190 }} placeholder="Note (optional)" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
          <button type="button" className="dash-filter active" disabled={busy} onClick={addShift}>Add shift</button>
          {addMsg && <span className="hint">{addMsg}</span>}
          {err && <span role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
        </div>
      </details>
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
