'use client';
import { useEffect, useState } from 'react';
import {
  SIDES, SEGMENTS, INTEREST_TAGS, LEAD_SOURCES_HUB, STAGES, TEMPERATURES, ACTIVITY_TYPES, OUTCOMES, LOST_REASONS
} from '../lib/lead-rules';

// The lead tracker: a list, a lead's page (timeline + the next step), a new-lead
// form and a CSV import that previews before it writes anything.
const label = (list, key) => (list.find((x) => x[0] === key) || [])[1] || key || '—';
const post = (body) => fetch('/api/sales/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const when = (d) => (d ? new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const blank = { side: '', company: '', contactName: '', email: '', phone: '', address: '', segment: '', source: '', temperature: 'cold', estValue: '', interestTags: [], nextStep: '', nextStepAt: '', assignTo: '' };

function Field({ id, name, children }) {
  return <div className="field" style={{ margin: 0 }}><label htmlFor={id}>{name}</label>{children}</div>;
}

function NewLead({ isAdmin, onDone, side }) {
  // A new lead starts on the side being looked at. Under All the rep has to choose, so a lead is never filed under both by accident.
  const [f, setF] = useState({ ...blank, side: side === 'bb' || side === 'rs' ? side : '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (t) => setF({ ...f, interestTags: f.interestTags.includes(t) ? f.interestTags.filter((x) => x !== t) : [...f.interestTags, t] });
  async function save() {
    if (!f.side) { setErr('Choose Bargain Bay or RS Solutions for this lead.'); return; }
    setBusy(true); setErr('');
    const r = await post({ action: 'create', lead: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Could not save.'); return; }
    setF({ ...blank, side: f.side }); onDone(r.id);
  }
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>New lead</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        <Field id="nl-company" name="Company"><input id="nl-company" value={f.company} onChange={set('company')} /></Field>
        <Field id="nl-contact" name="Contact name"><input id="nl-contact" value={f.contactName} onChange={set('contactName')} /></Field>
        <Field id="nl-phone" name="Phone"><input id="nl-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field id="nl-email" name="Email"><input id="nl-email" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field id="nl-side" name="Side"><select id="nl-side" value={f.side} onChange={set('side')}><option value="">Choose…</option>{SIDES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
        <Field id="nl-seg" name="Segment"><select id="nl-seg" value={f.segment} onChange={set('segment')}><option value="">—</option>{SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="nl-src" name="Source"><select id="nl-src" value={f.source} onChange={set('source')}><option value="">Self-sourced</option>{LEAD_SOURCES_HUB.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="nl-temp" name="Temperature"><select id="nl-temp" value={f.temperature} onChange={set('temperature')}>{TEMPERATURES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field id="nl-val" name="Estimated value ($)"><input id="nl-val" inputMode="decimal" value={f.estValue} onChange={set('estValue')} /></Field>
        <Field id="nl-next" name="Next step"><input id="nl-next" value={f.nextStep} onChange={set('nextStep')} /></Field>
        <Field id="nl-nextat" name="Next step date"><input id="nl-nextat" type="date" value={f.nextStepAt} onChange={set('nextStepAt')} /></Field>
        {isAdmin && <Field id="nl-assign" name="Assign to (email, blank = pool)"><input id="nl-assign" type="email" value={f.assignTo} onChange={set('assignTo')} /></Field>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {INTEREST_TAGS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={f.interestTags.includes(k)}
            style={{ padding: '5px 10px', fontSize: 12.5, borderRadius: 14, border: '1px solid var(--line, #ccc)', cursor: 'pointer',
              background: f.interestTags.includes(k) ? 'var(--charcoal, #222)' : 'transparent', color: f.interestTags.includes(k) ? '#fff' : 'inherit' }}>{l}</button>
        ))}
      </div>
      {err && <p style={{ color: 'var(--red, #c33)', fontSize: 14 }} role="alert">{err}</p>}
      <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save lead'}</button>
    </div>
  );
}

function ImportLeads({ onDone, side }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(commit) {
    setBusy(true); setErr('');
    const r = await post({ action: commit ? 'import-commit' : 'import-preview', text, side });
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Could not read that.'); return; }
    setRes({ ...r, committed: commit });
    if (commit) onDone();
  }
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Import leads</h2>
      <p className="hint" style={{ marginTop: 0 }}>Paste rows from a spreadsheet, headings first (Company, Contact, Email, Phone, Segment, Side). Rows with no Side go to the side you are viewing{side === 'bb' || side === 'rs' ? '' : ' (under All: marked Both)'}. Nothing is saved until you press Import.</p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5 }} aria-label="Pasted rows" />
      {err && <p style={{ color: 'var(--red, #c33)', fontSize: 14 }} role="alert">{err}</p>}
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <button className="btn" disabled={busy || !text.trim()} onClick={() => run(false)}>Preview</button>
        {res && !res.committed && res.ready > 0 && <button className="btn" disabled={busy} onClick={() => run(true)}>Import {res.ready}</button>}
      </div>
      {res && !res.committed && (
        <div style={{ fontSize: 13.5 }}>
          <b>{res.ready}</b> ready, <b>{res.skipped}</b> skipped.
          {res.preview.filter((p) => p.problems.length).slice(0, 15).map((p) => <div key={p.row} style={{ color: 'var(--red, #c33)' }}>Row {p.row}: {p.problems.join('; ')}</div>)}
        </div>
      )}
      {res?.committed && <p style={{ fontSize: 14 }}>Imported {res.created}. {res.skipped} skipped.{res.failed?.length ? ` ${res.failed.length} failed.` : ''}</p>}
    </div>
  );
}

function LeadDetail({ id, isAdmin, onChanged, onClose }) {
  const [lead, setLead] = useState(null);
  const [kind, setKind] = useState('call');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [nextAt, setNextAt] = useState('');
  const [lost, setLost] = useState('');
  const [assign, setAssign] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const load = () => fetch(`/api/sales/leads?id=${id}`).then((r) => r.json()).then((d) => setLead(d.lead || null));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body) {
    setErr('');
    const r = await post(body);
    if (!r.ok) { setErr(r.error || 'That did not work.'); return false; }
    await load(); onChanged(); return true;
  }
  if (!lead) return <div className="panel">Loading…</div>;
  const closed = lead.stage === 'won' || lead.stage === 'lost';
  return (
    <div className="panel" style={{ borderLeft: '4px solid var(--charcoal, #222)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{lead.company || lead.contact_name}</h2>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            {lead.company && lead.contact_name && <span>{lead.contact_name} · </span>}
            {lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}
            {lead.phone && <> · <a href={`https://wa.me/${String(lead.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></>}
            {lead.email && <> · <a href={`mailto:${lead.email}`}>{lead.email}</a></>}
          </div>
          <div className="hint" style={{ fontSize: 12.5, marginTop: 4 }}>
            {label(SIDES.map((s) => [s.key, s.label]), lead.side)} · {label(SEGMENTS, lead.segment)} · {label(LEAD_SOURCES_HUB, lead.source)} · {lead.temperature}
            {lead.est_value != null && ` · $${Number(lead.est_value).toLocaleString()}`}
          </div>
        </div>
        <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {!lead.customer_id && <button className="btn" onClick={async () => {
            const r = await post({ action: 'convert', id });
            if (!r.ok) { setErr(r.error || 'Could not convert.'); return; }
            setNote(r.existing ? (r.ownsIt ? 'Linked to an existing customer of yours.' : 'This is already a customer, so it was linked but not credited to you. The owner can assign it.') : 'Converted: this is now your account.');
            await load(); onChanged();
          }}>Convert to customer</button>}
          <button className="btn" onClick={onClose}>Close</button>
        </span>
      </div>

      {note && <p role="status" style={{ fontSize: 14, margin: '8px 0' }}>{note}</p>}
      {lead.customer_id && !note && <p className="hint" style={{ margin: '8px 0' }}>A customer ({'#'}{lead.customer_id}).</p>}
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>Stage</b>
        {STAGES.filter(([k]) => k !== 'won' && k !== 'lost').map(([k, l]) => (
          <button key={k} className="btn" style={{ fontSize: 12.5, opacity: lead.stage === k ? 1 : 0.55 }} disabled={closed && lead.stage !== k}
            onClick={() => act({ action: 'stage', id, stage: k })}>{l}</button>
        ))}
        {lead.stage === 'won' && <span className="pill ok">Won (paid)</span>}
        {lead.stage === 'lost' && <span className="pill sold">Lost — {label(LOST_REASONS, lead.lost_reason)}</span>}
      </div>
      {!closed && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={lost} onChange={(e) => setLost(e.target.value)} aria-label="Why lost"><option value="">Mark lost: why?</option>{LOST_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn" disabled={!lost} onClick={() => act({ action: 'stage', id, stage: 'lost', lostReason: lost })}>Mark lost</button>
          <span className="hint" style={{ fontSize: 12.5, alignSelf: 'center' }}>Won is set when the payment is recorded.</span>
        </div>
      )}

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input type="email" placeholder="Assign to (email)" value={assign} onChange={(e) => setAssign(e.target.value)} aria-label="Assign to" />
          <button className="btn" disabled={!assign} onClick={() => act({ action: 'assign', id, ownerEmail: assign })}>Assign</button>
          <button className="btn" onClick={() => act({ action: 'assign', id, ownerEmail: '' })}>Return to pool</button>
          <span className="hint" style={{ alignSelf: 'center', fontSize: 12.5 }}>Owner: {lead.owner_email || 'pool'}</span>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: '8px 0' }}>Log an activity</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">{ACTIVITY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome"><option value="">Outcome…</option>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" value={nextAt} onChange={(e) => setNextAt(e.target.value)} aria-label="Next step date" />
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What was said, what happens next" style={{ width: '100%', marginTop: 8 }} aria-label="Notes" />
      {err && <p style={{ color: 'var(--red, #c33)', fontSize: 14 }} role="alert">{err}</p>}
      <button className="btn" style={{ marginTop: 6 }}
        onClick={async () => { if (await act({ action: 'log', id, activity: { kind, outcome, notes, nextStepAt: nextAt } })) { setNotes(''); setOutcome(''); setNextAt(''); } }}>Log it</button>

      <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0' }}>
        {lead.activities.map((a) => (
          <li key={a.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 13.5 }}>
            <b>{label(ACTIVITY_TYPES, a.kind)}</b>{a.outcome ? ` · ${label(OUTCOMES, a.outcome)}` : ''}
            <span className="hint"> · {when(a.occurred_at)}{a.by_name ? ` · ${a.by_name}` : ''}</span>
            {a.notes && <div>{a.notes}</div>}
          </li>
        ))}
        {lead.activities.length === 0 && <li className="hint">Nothing logged yet.</li>}
      </ul>
    </div>
  );
}

export default function SalesLeads({ initial, isAdmin, openId, side = 'all' }) {
  const [leads, setLeads] = useState(initial);
  const [open, setOpen] = useState(openId);
  const [mode, setMode] = useState(null); // 'new' | 'import'
  const [q, setQ] = useState('');
  useEffect(() => setLeads(initial), [initial]);
  const reload = () => fetch(`/api/sales/leads?side=${side}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((r) => r.json()).then((d) => setLeads(d.leads || []));
  const shown = leads;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn" onClick={() => setMode(mode === 'new' ? null : 'new')}>+ New lead</button>
        <button className="btn" onClick={() => setMode(mode === 'import' ? null : 'import')}>Import</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reload()} placeholder="Search company, name, phone, email" aria-label="Search leads" style={{ flex: '1 1 240px' }} />
      </div>
      {mode === 'new' && <NewLead side={side} isAdmin={isAdmin} onDone={(id) => { setMode(null); setOpen(id); reload(); }} />}
      {mode === 'import' && <ImportLeads side={side} onDone={reload} />}
      {open && <LeadDetail id={open} isAdmin={isAdmin} onChanged={reload} onClose={() => setOpen(null)} />}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="admin" style={{ minWidth: 640 }}>
          <thead><tr><th>Company / contact</th><th>Stage</th><th>Temp</th><th>Source</th><th>Next step</th>{isAdmin && <th>Owner</th>}</tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} onClick={() => setOpen(l.id)} style={{ cursor: 'pointer' }}>
                <td><b>{l.company || l.contact_name}</b>{l.company && l.contact_name ? <div className="hint">{l.contact_name}</div> : null}</td>
                <td>{label(STAGES, l.stage)}</td><td>{l.temperature}</td><td>{label(LEAD_SOURCES_HUB, l.source)}</td>
                <td>{l.next_step || ''}{l.next_step_at ? <div className="hint">{l.next_step_at}</div> : null}</td>
                {isAdmin && <td>{l.owner_email || 'pool'}</td>}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="hint">No leads yet. Add one, or import a list.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
