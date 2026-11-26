'use client';
import { useEffect, useState } from 'react';

// The General Manager's review: money by business line, the moves worth the most,
// the refurb floor, the people, and today's targets. It shows what the morning
// review stored (lib/exec.js), so this page, the email and the phone call agree.
const money = (n) => (n == null ? 'not read' : `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-CA')}`);
const WORDS = { cleaned: 'units cleaned', assessed: 'units tested', repaired: 'repairs finished', checkedIn: 'units checked in', calls: 'calls logged', stops_proof: 'stops closed with proof' };
const RESULT = { met: 'Done', short: 'Short', nothing: 'Nothing recorded', off: 'Not in' };
const card = { background: '#fff', border: '1px solid #e3e0da', borderRadius: 8, padding: 14, marginBottom: 14 };
const h2 = { margin: '0 0 8px', fontSize: 15 };
// The shop's global input style is full width, which strands a checkbox above its label.
const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const box = { width: 'auto', margin: 0 };

export default function ManagerCommand() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/manager-exec', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load.');
      setData(j);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function post(body, label, done) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/manager-exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work. Try again in a minute.');
      await load();
      if (done) setMsg(done);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  if (!data) return <div className="wrap"><p className="hint">{err || 'Loading the review...'}</p></div>;
  const { review: s, config, targets = [] } = data;
  const j = s?.judgement;

  return (
    <div className="wrap">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <h1 style={{ margin: 0, marginRight: 'auto', color: 'var(--charcoal)' }}>General Manager</h1>
        <button className="btn" disabled={!!busy} onClick={() => post({ action: 'review' }, 'review', 'Reviewed.')}>{busy === 'review' ? 'Reviewing (about a minute)...' : 'Review now'}</button>
        {s && <button className="btn" disabled={!!busy} onClick={() => post({ action: 'email' }, 'email', 'Emailed to you.')}>Email me this</button>}
      </div>
      {err && <p style={{ color: '#b3261e' }}>{err}</p>}
      {msg && <p className="hint">{msg}</p>}

      <div style={card}>
        <label style={row}><input type="checkbox" style={box} checked={config.emailBrief} disabled={!!busy} onChange={(e) => post({ action: 'config', emailBrief: e.target.checked }, 'config')} /> Email me the brief every morning at 7</label>
        <label style={row}><input type="checkbox" style={box} checked={config.textStaff} disabled={!!busy} onChange={(e) => {
          if (e.target.checked && !confirm('Each morning, once someone clocks in, the Manager will TEXT them their target for the day. Switch on?')) return;
          post({ action: 'config', textStaff: e.target.checked }, 'config');
        }} /> Text each person their daily target when they clock in</label>
        <label style={row}><input type="checkbox" style={box} checked={config.pushStaff} disabled={!!busy || !config.textStaff}
          onChange={(e) => post({ action: 'config', pushStaff: e.target.checked }, 'config')} /> Push them every 2-3 hours while they are clocked in</label>
        <label style={{ ...row, marginTop: 6 }}>Client delivery work is already invoiced up to
          <input type="date" style={{ width: 'auto', margin: 0 }} defaultValue={config.billedThrough} disabled={!!busy}
            onChange={(e) => post({ action: 'config', billedThrough: e.target.value }, 'config', 'Saved. Press Review now to recount.')} /></label>
      </div>

      {!s ? <p>No review yet. Press <b>Review now</b>; after that it runs every morning.</p> : (
        <>
          <div style={card}>
            <p style={{ fontSize: 17, margin: '0 0 6px' }}><b>{s.verdict}</b></p>
            {j?.ok && <p style={{ margin: 0 }}>{j.headline}</p>}
            {j && !j.ok && <p className="hint">Written judgement unavailable: {j.error}</p>}
            <p className="hint" style={{ margin: '6px 0 0' }}>Reviewed {new Date(s.at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</p>
          </div>

          {j?.ok && j.decisions.length > 0 && <div style={card}><h2 style={h2}>Decide today</h2>
            {j.decisions.map((d) => <p key={d.decision}><b>{d.decision}</b><br />My pick: {d.recommend} <span className="hint">{d.why}</span></p>)}
          </div>}

          <div style={card}><h2 style={h2}>Money moves, biggest first</h2>
            {s.plays.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{s.plays.map((p) => <li key={p.key} style={{ marginBottom: 6 }}><b>{p.title}</b> <span className="hint">({p.basis})</span><br />{p.action}</li>)}</ol> : <p>Nothing stuck.</p>}
          </div>

          <div style={card}><h2 style={h2}>Revenue lines: day {s.win.day} against the same days last month</h2>
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}><thead><tr><th>Line</th><th>This month</th><th>Last month</th><th>Change</th><th>On pace for</th></tr></thead>
              <tbody>{s.streams.map((x) => <tr key={x.key}><td>{x.label}</td><td>{money(x.now)}</td><td>{money(x.before)}</td>
                <td style={{ color: x.change < 0 ? '#b3261e' : '#1b6e3c' }}>{x.change == null ? '' : `${x.change > 0 ? '+' : ''}${x.change}%`}</td><td>{x.runRate == null ? '' : money(x.runRate)}</td></tr>)}</tbody></table></div>
            {s.pnl && <p className="hint">Gross profit {money(s.pnl.productProfit)} + delivery {money(s.pnl.deliveryIncome)}, less delivery costs {money(s.pnl.deliveryCost)}, wages {money(s.pnl.wages)}, overhead {money(s.pnl.overhead)}.</p>}
            {s.salesShare && <p className="hint">{s.salesShare.housePct}% of the last {s.salesShare.days} days&apos; sales were closed under the owner or company login; staff closed {money(s.salesShare.staff)}.</p>}
          </div>

          <div style={card}><h2 style={h2}>Your people, last 14 days</h2>
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}><thead><tr><th>Who</th><th>Hours</th><th>Wages</th><th>What got done</th><th>Ask about</th></tr></thead>
              <tbody>{s.people.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.hours}</td><td>{money(p.cost)}</td><td>{p.line}</td>
                <td style={{ color: '#8a5a00' }}>{p.flags.map((f) => f.text).join('; ')}</td></tr>)}</tbody></table></div>
            {j?.ok && j.coaching.map((c) => <p key={c.name} style={{ margin: '8px 0 0' }}><b>{c.name}</b>: {c.say}</p>)}
          </div>

          <div style={card}><h2 style={h2}>Targets</h2>
            {targets.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{targets.map((a) => <li key={a.id}><b>{a.name}</b>: {a.target} {WORDS[a.metric] || a.metric} <span className="hint">({a.why}){a.texted_at ? ', texted' : ''}{a.pushes ? `, pushed ${a.pushes} time${a.pushes === 1 ? '' : 's'}` : ''}{a.onClock ? ', clocked in' : ''}</span>
              {a.hasPhone === false && <span style={{ color: '#b3261e' }}> no mobile on file, cannot be texted</span>}</li>)}</ul> : <p>No targets today.</p>}
            {s.yesterday?.length > 0 && <><p style={{ margin: '10px 0 2px' }}><b>Yesterday</b></p><ul style={{ margin: 0, paddingLeft: 18 }}>{s.yesterday.map((a) => <li key={a.id}>{a.name}: {a.actual ?? '-'} of {a.target} {WORDS[a.metric] || a.metric}{a.status ? ` - ${RESULT[a.status]}` : ''}</li>)}</ul></>}
          </div>

          {s.flow && <div style={card}><h2 style={h2}>Refurb floor</h2>
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}><thead><tr><th>Stage</th><th>Units</th><th>Oldest (days)</th><th>Done per working day</th><th>Days to clear</th></tr></thead>
              <tbody>{s.flow.stages.map((x) => <tr key={x.key} style={x.key === s.flow.constraint?.key ? { background: '#fff4d6' } : null}><td>{x.label}{x.key === s.flow.constraint?.key ? ' (bottleneck)' : ''}</td><td>{x.count}</td><td>{x.oldestDays ?? ''}</td><td>{x.perWorkingDay ?? ''}</td><td>{x.stalled ? 'not moving' : x.daysToClear ?? ''}</td></tr>)}</tbody></table></div>
            {s.flow.parked > 0 && <p className="hint">{s.flow.parked} units are parked in Misc.</p>}
            {s.flow.readyNotOnSite?.length > 0 && <details><summary>{s.flow.readyNotOnSite.length} finished units not for sale on the website</summary><p className="hint">{s.flow.readyNotOnSite.map((u) => `${u.id} (${u.model})`).join(', ')}</p></details>}
          </div>}

          {j?.ok && (j.efficiency.length > 0 || j.growth.length > 0) && <div style={card}><h2 style={h2}>Run it better</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{[...j.efficiency, ...j.growth].map((x) => <li key={x}>{x}</li>)}</ul></div>}

          {(s.blind.length > 0 || s.pnl?.warnings?.length > 0) && <div style={card}><h2 style={h2}>What these figures are missing</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{[...s.blind.map((b) => `Could not read ${b}`), ...(s.pnl?.warnings || [])].map((x) => <li key={x}>{x}</li>)}</ul></div>}
        </>
      )}
    </div>
  );
}
