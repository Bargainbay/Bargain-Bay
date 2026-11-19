'use client';
import { useState } from 'react';
import { LEAD_SOURCES_HUB, WANTED_CATEGORIES, LOST_REASONS } from '../lib/lead-rules';

// The lead log: write a lead down in ten seconds, see today's list, and see the funnel.
// "Bought" is never a button: it is worked out from the orders (lib/lead-log.js), so the conversion figure cannot be flattered.
const label = (list, key) => (list.find((x) => x[0] === key) || [])[1] || key || '';
const api = (method, body) => fetch('/api/admin/lead-log' + (method === 'GET' ? `?days=${body}` : ''), {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body)
}).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const when = (d) => (d ? new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const pct = (v) => (v == null ? '—' : `${v}%`);
const DETAIL_SOURCES = ['partner', 'referral', 'lead_team'];
const blank = { contactName: '', phone: '', email: '', source: '', sourceDetail: '', wantedCategory: '', wanted: '', notes: '', assignTo: '' };

function Field({ id, name, children }) {
  return <div className="field" style={{ margin: 0 }}><label htmlFor={id}>{name}</label>{children}</div>;
}
function Kpi({ label: l, value, sub }) {
  return <div className="kpi-card"><div className="kpi-value">{value}</div><div className="kpi-label">{l}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>;
}

function Row({ l, reps, isAdmin, onChanged }) {
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState(l.owner_email || '');
  const [adding, setAdding] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [err, setErr] = useState('');
  async function lose(r) {
    if (!r) return;
    setErr('');
    const res = await api('POST', { action: 'outcome', id: l.id, outcome: 'lost', lostReason: r });
    if (!res.ok) { setErr(res.error || 'Could not save.'); return; }
    onChanged();
  }
  async function reopen() {
    const res = await api('POST', { action: 'outcome', id: l.id, outcome: 'open' });
    if (!res.ok) { setErr(res.error || 'Could not save.'); return; }
    onChanged();
  }
  async function assign() {
    setErr('');
    const res = await api('POST', { action: 'assign', id: l.id, ownerEmail: owner });
    if (!res.ok) { setErr(res.error || 'Could not assign.'); return; }
    onChanged();
  }
  async function addNote() {
    if (!noteText.trim()) return;
    setErr('');
    const res = await api('POST', { action: 'note', id: l.id, notes: noteText });
    if (!res.ok) { setErr(res.error || 'Could not save the note.'); return; }
    setNoteText(''); setAdding(false);
    onChanged();
  }
  const status = l.status === 'bought' ? <span className="pill paid">Bought</span>
    : l.status === 'lost' ? <span className="pill sold">Lost — {label(LOST_REASONS, l.lost_reason)}</span>
    : <span className="pill">Open</span>;
  return (
    <tr>
      <td>{when(l.created_at)}</td>
      <td><b>{l.contact_name || l.company}</b><div className="hint">{[l.phone, l.email].filter(Boolean).join(' · ')}</div></td>
      <td>{label(LEAD_SOURCES_HUB, l.source) || <span className="hint">Not recorded</span>}{l.detail ? <div className="hint">{l.detail}</div> : null}</td>
      <td>{[label(WANTED_CATEGORIES, l.wanted_category), l.wanted].filter(Boolean).join(' · ') || <span className="hint">—</span>}
        {l.note && <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>Note: {l.note}</div>}
        {adding ? (
          <div style={{ marginTop: 4 }}>
            <textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} aria-label="Note" style={{ width: '100%' }} />
            <button type="button" className="btn" onClick={addNote} style={{ fontSize: 12 }}>Save note</button>{' '}
            <button type="button" onClick={() => setAdding(false)} style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} style={{ background: 'none', border: 0, padding: 0, marginTop: 2, color: 'var(--link, #06c)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}>{l.note ? 'Add another note' : 'Add note'}</button>
        )}
      </td>
      <td>
        {(isAdmin || l.owner_email) ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <input type="email" list="ll-reps" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Unassigned" aria-label="Assign to" style={{ width: 160 }} />
            <button type="button" className="btn" style={{ fontSize: 12 }} disabled={owner === (l.owner_email || '') || (!isAdmin && !owner)} onClick={assign}>{owner ? 'Assign' : 'Unassign'}</button>
          </div>
        ) : <span className="hint">—</span>}
      </td>
      <td>
        {status}
        {l.status !== 'bought' && (
          <div style={{ marginTop: 4 }}>
            {l.status === 'lost'
              ? <button type="button" onClick={reopen} style={{ background: 'none', border: 0, padding: 0, color: 'var(--link, #06c)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Reopen</button>
              : (
                <select aria-label="Mark lost: why" value={reason} onChange={(e) => { setReason(e.target.value); lose(e.target.value); }}>
                  <option value="">Mark lost: why?</option>
                  {LOST_REASONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              )}
          </div>
        )}
        {err && <div role="alert" style={{ color: 'var(--red, #c33)', fontSize: 12.5 }}>{err}</div>}
      </td>
    </tr>
  );
}

export default function LeadLog({ initial, isAdmin }) {
  const [data, setData] = useState(initial);
  const [days, setDays] = useState(30);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const reload = async (d = days) => { const r = await api('GET', d); if (r.ok) setData({ funnel: r.funnel, log: r.log, details: r.details, reps: r.reps || data.reps }); };

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setNote('');
    const r = await api('POST', { action: 'log', lead: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Could not save.'); return; }
    // Keep the source: the next lead in a batch from the same partner is usually the same source.
    setF({ ...blank, source: f.source, sourceDetail: f.sourceDetail, assignTo: f.assignTo });
    setNote('Logged.');
    reload();
  }

  const fn = data.funnel;
  return (
    <div>
      <datalist id="ll-reps">{(data.reps || []).map((r) => <option key={r} value={r} />)}</datalist>
      <form className="panel" onSubmit={save}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Log a lead</h2>
        <p className="hint" style={{ marginTop: 0 }}>Write it down the day it arrives. Name, a way to reach them and where it came from are enough; add what they asked for if you know.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          <Field id="ll-name" name="Name"><input id="ll-name" value={f.contactName} onChange={set('contactName')} autoComplete="off" /></Field>
          <Field id="ll-phone" name="Phone"><input id="ll-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id="ll-email" name="Email"><input id="ll-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field id="ll-src" name="Where it came from">
            <select id="ll-src" value={f.source} onChange={set('source')} required><option value="">Choose…</option>{LEAD_SOURCES_HUB.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          {DETAIL_SOURCES.includes(f.source) && (
            <Field id="ll-detail" name={f.source === 'lead_team' ? 'Which team or person' : 'Which partner'}>
              <input id="ll-detail" list="ll-details" value={f.sourceDetail} onChange={set('sourceDetail')} autoComplete="off" />
              <datalist id="ll-details">{(data.details || []).map((d) => <option key={d} value={d} />)}</datalist>
            </Field>
          )}
          <Field id="ll-cat" name="What they want">
            <select id="ll-cat" value={f.wantedCategory} onChange={set('wantedCategory')}><option value="">—</option>{WANTED_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field id="ll-wanted" name="Model, size or budget"><input id="ll-wanted" value={f.wanted} onChange={set('wanted')} placeholder="e.g. LG 36in French door, under $1,200" autoComplete="off" /></Field>
          <Field id="ll-notes" name="Notes"><textarea id="ll-notes" rows={2} value={f.notes} onChange={set('notes')} placeholder="Anything worth remembering: what they said, when to call back" /></Field>
          {(
            <Field id="ll-assign" name={isAdmin ? 'Assign to (blank = unassigned)' : 'Assign to (blank = me)'}>
              <input id="ll-assign" type="email" list="ll-reps" value={f.assignTo} onChange={set('assignTo')} autoComplete="off" />
            </Field>
          )}
        </div>
        {err && <p role="alert" style={{ color: 'var(--red, #c33)', fontSize: 14 }}>{err}</p>}
        {note && <p role="status" style={{ color: 'var(--green, #2a7)', fontSize: 14 }}>{note}</p>}
        <button className="btn" disabled={busy} style={{ marginTop: 8 }}>{busy ? 'Saving…' : 'Log lead'}</button>
      </form>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>What became of them</h2>
          <label style={{ fontSize: 13.5 }}>Last{' '}
            <select value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); reload(d); }} aria-label="Period">
              {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>
        <p className="hint">{isAdmin ? 'Everyone’s leads.' : 'Your leads.'} A lead counts as bought when an order exists for their email or phone after it was logged. Leads still open may yet buy, so recent days read low.</p>
        <div className="dash-kpis" style={{ marginTop: 10 }}>
          <Kpi label="Leads logged" value={fn.total} sub={`${fn.open} still open`} />
          <Kpi label="Bought" value={pct(fn.conversionPct)} sub={`${fn.bought} of ${fn.total} leads`} />
          <Kpi label="Lost" value={fn.lost} sub={fn.decidedPct == null ? '' : `${pct(fn.decidedPct)} of decided leads bought`} />
          <Kpi label="Lost: no stock" value={fn.noStock} sub={fn.noStockPct == null ? '' : `${pct(fn.noStockPct)} of all leads`} />
        </div>

        <h3 style={{ marginTop: 18, fontSize: 15 }}>By source</h3>
        <div className="table-wrap"><table className="admin" style={{ minWidth: 560 }}>
          <thead><tr><th>Source</th><th>Leads</th><th>Bought</th><th>Conversion</th><th>Lost: no stock</th><th>Open</th></tr></thead>
          <tbody>
            {fn.bySource.map((b) => (
              <tr key={`${b.source}|${b.detail}`}>
                <td>{b.label}{b.detail ? <div className="hint">{b.detail}</div> : null}</td>
                <td>{b.leads}</td><td>{b.bought}</td><td>{pct(b.conversionPct)}</td><td>{b.noStock}</td><td>{b.open}</td>
              </tr>
            ))}
            {fn.bySource.length === 0 && <tr><td colSpan={6} className="hint">No leads logged in this period yet.</td></tr>}
          </tbody>
        </table></div>

        <h3 style={{ marginTop: 18, fontSize: 15 }}>What people asked for that we did not have</h3>
        {fn.missed.length === 0
          ? <p className="hint">Nothing yet. When a lead is marked “We did not have what they wanted”, what they asked for shows here — it is the list to buy against.</p>
          : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
                {fn.missed.map((m) => <span key={m.category} className="pill">{m.label}: <b>{m.count}</b></span>)}
              </div>
              <ul style={{ fontSize: 13.5, margin: '10px 0 0', paddingLeft: 18 }}>
                {fn.missedItems.map((m) => <li key={m.id}>{m.day} — {[m.category, m.wanted].filter(Boolean).join(' · ') || 'not recorded'}</li>)}
              </ul>
            </>
          )}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Recent leads</h2>
        <div className="table-wrap"><table className="admin" style={{ minWidth: 700 }}>
          <thead><tr><th>Logged</th><th>Who</th><th>Source</th><th>Wanted &amp; notes</th><th>Assigned to</th><th>Outcome</th></tr></thead>
          <tbody>
            {data.log.map((l) => <Row key={l.id} l={l} reps={data.reps} isAdmin={isAdmin} onChanged={() => reload()} />)}
            {data.log.length === 0 && <tr><td colSpan={6} className="hint">No leads logged in the last 14 days.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
