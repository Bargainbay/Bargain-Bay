'use client';
import { useEffect, useState } from 'react';
import StatementView from './StatementView';

// The owner's commission screen: who is on the plan, the weekly statement to approve and pay, whose
// account is whose (with a reason), the rep's shop days, and the day-30 report.
const api = (path, body) => (body
  ? fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  : fetch(path)).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d) => { const x = new Date(`${d}T12:00:00Z`); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const local = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'open');
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function Plans({ data, reload, pick, rep }) {
  const [f, setF] = useState({ rep: '', startDate: '', quota: '150000', quotaDays: '30' });
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    const r = await api('/api/admin/sales-commission', { action: 'set_plan', rep: f.rep, plan: { startDate: f.startDate, quota: f.quota, quotaDays: f.quotaDays } });
    if (!r.ok) { setErr(r.error); return; }
    pick(f.rep.trim().toLowerCase()); reload();
  }
  const plans = Object.entries(data.plans || {});
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Reps on the commission plan</h2>
      {plans.map(([email, p]) => (
        <div key={email} style={{ padding: '6px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={() => pick(email)} style={{ fontWeight: email === rep ? 800 : 400 }}>{email}</button>
          <span>from {p.startDate} · quota {money(p.quota)} in {p.quotaDays} days</span>
          <button className="btn" onClick={async () => { if (confirm(`Remove ${email} from the plan? They will stop earning commission from today's view.`)) { await api('/api/admin/sales-commission', { action: 'remove_plan', rep: email }); reload(); } }}>Remove</button>
        </div>
      ))}
      {plans.length === 0 && <p className="hint">Nobody is on the plan yet.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
        <label>Rep email<input type="email" value={f.rep} onChange={(e) => setF({ ...f, rep: e.target.value })} /></label>
        <label>Start date<input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
        <label>Quota $<input value={f.quota} inputMode="decimal" style={{ width: 100 }} onChange={(e) => setF({ ...f, quota: e.target.value })} /></label>
        <label>in days<input value={f.quotaDays} inputMode="numeric" style={{ width: 70 }} onChange={(e) => setF({ ...f, quotaDays: e.target.value })} /></label>
        <button className="btn accent" onClick={save}>Add / update</button>
      </div>
      {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
    </div>
  );
}

function Tiers({ data, reload }) {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { setRows((data.tiers || []).map((t) => ({ ...t }))); }, [data.tiers]);
  if (!rows) return null;
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Daily commission tiers</h2>
      <p className="hint" style={{ marginTop: 0 }}>The rate applies to the whole day&apos;s collected sales. “Over” means strictly more than the line; tick “or more” to include it.
        The agreement says “over $30,000” but its example pays 2% on exactly $30,000 — tick the last box if you want the example to hold.</p>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', flexWrap: 'wrap' }}>
          {t.inclusive ? '$' : 'Over $'}<input value={t.over} inputMode="decimal" style={{ width: 90 }} aria-label="Line" onChange={(e) => set(i, 'over', e.target.value)} />
          pays <input value={t.pct} inputMode="decimal" style={{ width: 60 }} aria-label="Percent" onChange={(e) => set(i, 'pct', e.target.value)} />%
          <label><input type="checkbox" style={{ width: 'auto' }} checked={!!t.inclusive} onChange={(e) => set(i, 'inclusive', e.target.checked)} /> or more</label>
        </div>
      ))}
      <button className="btn" onClick={async () => { const r = await api('/api/admin/sales-commission', { action: 'set_tiers', tiers: rows }); setMsg(r.ok ? 'Saved.' : r.error); reload(); }}>Save tiers</button>
      {msg && <span role="status" className="hint"> {msg}</span>}
    </div>
  );
}

function Statement({ rep }) {
  const [week, setWeek] = useState(mondayOf(todayIso()));
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api(`/api/admin/sales-commission?view=statement&rep=${encodeURIComponent(rep)}&week=${week}`).then(setD);
  useEffect(() => { load(); }, [rep, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = d?.statement;
  async function act(action) { setErr(''); const r = await api('/api/admin/sales-commission', { action, rep, week }); if (!r.ok) setErr(r.error); await load(); }
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Weekly statement — {rep}</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn" onClick={() => setWeek(addDays(week, -7))}>← Previous</button>
        <button className="btn" onClick={() => setWeek(addDays(week, 7))}>Next →</button>
        <button className="btn" onClick={() => setWeek(mondayOf(todayIso()))}>This week</button>
        {s && <a className="btn" href={`/api/admin/sales-commission?view=statement&rep=${encodeURIComponent(rep)}&week=${week}&format=csv`}>Download CSV</a>}
        <button className="btn" onClick={() => window.print()}>Print / save as PDF</button>
      </div>
      {s && <StatementView s={s} />}
      {s && s.status === 'draft' && <button className="btn accent" style={{ marginTop: 10 }} onClick={() => act('approve')}>Approve this week</button>}
      {s && s.status === 'approved' && <button className="btn accent" style={{ marginTop: 10 }} onClick={() => act('paid')}>Mark as paid</button>}
      {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
    </div>
  );
}

function Attribution({ rep, owned, reload }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  async function find() { const r = await api(`/api/admin/sales-commission?view=find&q=${encodeURIComponent(q)}`); setFound(r); }
  async function assign(kind, id, owner) {
    setMsg('');
    const r = await api('/api/admin/sales-commission', kind === 'customer' ? { action: 'set_owner', customerId: id, owner, reason } : { action: 'set_vendor', vendorId: id, owner, reason });
    setMsg(r.ok ? 'Done.' : r.error); if (r.ok) { find(); reload(); }
  }
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Whose account is it?</h2>
      <p className="hint" style={{ marginTop: 0 }}>A customer the rep brought in earns commission on every paid order, any day. Assigning one takes a written reason and is logged.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer or liquidation partner" aria-label="Find" style={{ flex: '1 1 260px' }} onKeyDown={(e) => e.key === 'Enter' && find()} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" style={{ flex: '1 1 220px' }} />
        <button className="btn" onClick={find}>Search</button>
      </div>
      {msg && <p role="status">{msg}</p>}
      {found && (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          {found.customers.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--line, #eee)' }}>
              <span style={{ flex: 1 }}>{c.name || c.email} <span className="hint">{c.email} · owner: {c.owner_email || 'nobody'}</span></span>
              <button className="btn" onClick={() => assign('customer', c.id, rep)}>Give to {rep.split('@')[0]}</button>
              {c.owner_email && <button className="btn" onClick={() => assign('customer', c.id, '')}>Clear</button>}
            </div>
          ))}
          {found.vendors.map((v) => (
            <div key={`v${v.id}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--line, #eee)' }}>
              <span style={{ flex: 1 }}>Partner: {v.name} <span className="hint">sourced by: {v.sourced_by_email || 'nobody'}</span></span>
              <button className="btn" onClick={() => assign('vendor', v.id, rep)}>Sourced by {rep.split('@')[0]}</button>
              {v.sourced_by_email && <button className="btn" onClick={() => assign('vendor', v.id, '')}>Clear</button>}
            </div>
          ))}
          {!found.customers.length && !found.vendors.length && <p className="hint">Nothing found.</p>}
        </div>
      )}
      <h3 style={{ fontSize: 14, margin: '14px 0 4px' }}>Accounts credited to {rep} ({owned.length})</h3>
      {owned.map((c) => <div key={c.id} className="hint" style={{ fontSize: 13 }}>{c.name || c.email} — {c.owner_reason || ''}</div>)}
    </div>
  );
}

function Shifts({ rep, shifts, reload }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Shop days</h2>
      <p className="hint" style={{ marginTop: 0 }}>A day with a shop clock-in is an In-house Day. Fix a forgotten clock-in or clock-out here; every change is logged.</p>
      {shifts.map((s) => <ShiftRow key={`${s.id}-${s.started_at}-${s.ended_at}`} s={s} reload={reload} setErr={setErr} />)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
        <label>Add a shop day — in<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>out<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="btn" disabled={!start} onClick={async () => { setErr(''); const r = await api('/api/admin/sales-commission', { action: 'add_shift', rep, startedAt: new Date(start).toISOString(), endedAt: end ? new Date(end).toISOString() : null }); if (!r.ok) setErr(r.error); else { setStart(''); setEnd(''); reload(); } }}>Add</button>
      </div>
      {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
    </div>
  );
}
function ShiftRow({ s, reload, setErr }) {
  const [a, setA] = useState(toInput(s.started_at));
  const [b, setB] = useState(toInput(s.ended_at));
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 13.5 }}>
      <span style={{ width: 110 }}>{s.day}</span>
      <input type="datetime-local" value={a} onChange={(e) => setA(e.target.value)} aria-label="Clock in" />
      <input type="datetime-local" value={b} onChange={(e) => setB(e.target.value)} aria-label="Clock out" />
      <button className="btn" onClick={async () => { setErr(''); const r = await api('/api/admin/sales-commission', { action: 'fix_shift', id: s.id, startedAt: a ? new Date(a).toISOString() : null, endedAt: b ? new Date(b).toISOString() : null }); if (!r.ok) setErr(r.error); else reload(); }}>Save</button>
      <span className="hint">{s.ended_at ? '' : `open since ${local(s.started_at)}`}{s.edited_by ? ` · edited by ${s.edited_by}` : ''}</span>
    </div>
  );
}

function DayReport({ d }) {
  if (!d) return <div className="panel"><h2 style={{ marginTop: 0, fontSize: 16 }}>Quota report</h2><p className="hint">No plan for this rep.</p></div>;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Quota report {d.windowStart} – {d.windowEnd} {d.finished ? '(final)' : `(as of ${d.asOf})`}</h2>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{money(d.collected)} <span style={{ fontSize: 14, fontWeight: 400 }}>of {money(d.quota)}{d.percent != null ? ` — ${d.percent}%` : ''} {d.met ? '· quota met' : ''}</span></div>
      <div className="hint">Before HST, net of {money(d.refunded)} refunded. Commission earned in the window: {money(d.commission)}.</div>
      <div style={{ marginTop: 6, fontSize: 14 }}>
        Touches {d.activity.touches || 0} · conversations {d.activity.conversations || 0} · meetings booked {d.activity.meetings || 0} · proposals {d.activity.proposals || 0}
        {' · '}open pipeline {d.pipeline.open || 0} deals ({money(d.pipeline.value)})
      </div>
    </div>
  );
}

export default function SalesCommissionAdmin() {
  const [data, setData] = useState(null);
  const [rep, setRep] = useState('');
  const [detail, setDetail] = useState(null);
  const loadAll = () => api('/api/admin/sales-commission').then((d) => { setData(d); setRep((r) => r || Object.keys(d.plans || {})[0] || ''); });
  const loadRep = () => rep && api(`/api/admin/sales-commission?view=rep&rep=${encodeURIComponent(rep)}`).then(setDetail);
  useEffect(() => { loadAll(); }, []);
  useEffect(() => { setDetail(null); loadRep(); }, [rep]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="panel">Loading…</div>;
  return (
    <div>
      <Plans data={data} reload={loadAll} pick={setRep} rep={rep} />
      <Tiers data={data} reload={loadAll} />
      {rep && data.plans?.[rep] && (
        <>
          <Statement rep={rep} />
          {detail && <DayReport d={detail.day} />}
          {detail && <Attribution rep={rep} owned={detail.owned} reload={loadRep} />}
          {detail && <Shifts rep={rep} shifts={detail.shifts} reload={loadRep} />}
        </>
      )}
    </div>
  );
}
