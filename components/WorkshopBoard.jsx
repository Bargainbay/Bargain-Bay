'use client';
import { useEffect, useMemo, useState } from 'react';
import { WORKSHOP_STATUSES, NOTE_KINDS } from '../lib/workshop-rules';

// Kanban over workshop applications. Columns are the pipeline; "spoke to them" is a separate tag on every card, so
// the two questions (where are they, have we talked) are never mixed. Junk is a column that starts folded.
const api = '/api/admin/workshop-applications';
const fmt = (d) => (d ? new Date(d).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function WorkshopBoard() {
  const [apps, setApps] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all'); // all | not | spoke
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const [showJunk, setShowJunk] = useState(false);
  const [open, setOpen] = useState(null);

  async function load() {
    try {
      const r = await fetch(api);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load.');
      setApps(j.applications); setErr('');
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function act(body, optimistic) {
    setErr('');
    const prev = apps;
    if (optimistic) setApps((xs) => xs.map(optimistic));
    const r = await post(body);
    if (!r.ok) { setApps(prev); setErr((await r.json().catch(() => ({}))).error || 'That did not work.'); return false; }
    return true;
  }
  const move = (ids, status) => act({ action: 'status', ids, status }, (a) => (ids.includes(a.id) ? { ...a, status } : a)).then(() => setSel([]));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (apps || []).filter((a) =>
      (filter === 'all' || (filter === 'spoke') === a.spoken_to) &&
      (!needle || [a.name, a.email, a.phone, a.city].some((v) => String(v || '').toLowerCase().includes(needle))));
  }, [apps, filter, q]);

  if (!apps) return <p className="hint">{err || 'Loading…'}</p>;
  const spokeN = apps.filter((a) => a.spoken_to && a.status !== 'junk').length;
  const notN = apps.filter((a) => !a.spoken_to && a.status !== 'junk').length;
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['all', `All (${apps.filter((a) => a.status !== 'junk').length})`], ['not', `Not spoken to (${notN})`], ['spoke', `Spoke to (${spokeN})`]].map(([k, l]) => (
          <button key={k} className="btn" aria-pressed={filter === k} onClick={() => setFilter(k)} style={filter === k ? { background: 'var(--charcoal)', color: '#fff' } : undefined}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, city" aria-label="Search applicants" style={{ minWidth: 220 }} />
        <button className="btn" onClick={() => setShowJunk((v) => !v)}>{showJunk ? 'Hide' : 'Show'} junk ({apps.filter((a) => a.status === 'junk').length})</button>
      </div>
      {sel.length > 0 && (
        <div className="panel" role="region" aria-label="Selected applicants" style={{ marginBottom: 10 }}>
          <b>{sel.length} selected</b>{' '}
          <button className="btn" onClick={() => { if (confirm(`Mark ${sel.length} applicant${sel.length > 1 ? 's' : ''} as junk?`)) move(sel, 'junk'); }}>Mark as junk</button>{' '}
          <button className="btn" onClick={() => setSel([])}>Clear</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {WORKSHOP_STATUSES.filter(([k]) => k !== 'junk' || showJunk).map(([status, label]) => {
          const cards = shown.filter((a) => a.status === status);
          return (
            <section key={status} aria-label={label}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = Number(e.dataTransfer.getData('text/plain')); if (id) move([id], status); }}
              style={{ flex: '0 0 270px', background: status === 'junk' ? '#f3e6e6' : 'var(--panel-alt, #f4f4f4)', borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ fontSize: 14 }}>{label}</b><span className="hint">{cards.length}</span></div>
              {cards.map((a) => <Card key={a.id} a={a} selected={sel.includes(a.id)} onSelect={() => toggle(a.id)} onOpen={() => setOpen(a)} onMove={(s) => move([a.id], s)} />)}
              {!cards.length && <p className="hint" style={{ margin: '8px 0 0' }}>Nobody here.</p>}
            </section>
          );
        })}
      </div>
      {open && <Detail a={apps.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} onChanged={load} onMove={(s) => move([open.id], s)} />}
    </div>
  );
}

function Tag({ spoken }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: spoken ? '#dff3e1' : '#fff0d0', color: spoken ? '#1f6b2c' : '#8a5a00' }}>{spoken ? 'Spoke to' : 'Not spoken to'}</span>;
}

function Card({ a, selected, onSelect, onOpen, onMove }) {
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(a.id))}
      style={{ background: 'var(--card, #fff)', border: `1px solid ${selected ? 'var(--charcoal, #333)' : 'var(--line, #ddd)'}`, borderRadius: 8, padding: 8, marginTop: 8, fontSize: 13.5 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${a.name}`} style={{ marginTop: 3 }} />
        <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700, color: 'var(--charcoal)', flex: 1 }}>{a.name}</button>
      </div>
      <div style={{ margin: '4px 0' }}><Tag spoken={a.spoken_to} />{a.note_count > 0 && <span className="hint"> · {a.note_count} note{a.note_count > 1 ? 's' : ''}</span>}</div>
      <div className="hint">{a.phone}{a.city ? ` · ${a.city}` : ''}</div>
      {a.last_note && <div className="hint" style={{ fontStyle: 'italic', marginTop: 4 }}>“{a.last_note.length > 90 ? a.last_note.slice(0, 90) + '…' : a.last_note}”</div>}
      <div style={{ marginTop: 6 }}>
        <select value={a.status} onChange={(e) => onMove(e.target.value)} aria-label={`Move ${a.name}`}>
          {WORKSHOP_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}

function Detail({ a, onClose, onChanged, onMove }) {
  const [notes, setNotes] = useState(null);
  const [kind, setKind] = useState('spoke');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadNotes() { const r = await fetch(`${api}?id=${a.id}`); const j = await r.json().catch(() => ({})); setNotes(j.notes || []); }
  useEffect(() => { loadNotes(); }, [a.id]);

  async function save() {
    setBusy(true); setErr('');
    const r = await post({ action: 'note', id: a.id, kind, body });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Could not save.'); return; }
    setBody(''); await loadNotes(); onChanged();
  }
  async function toggleSpoken() { await post({ action: 'spoken', id: a.id, spoken: !a.spoken_to }); onChanged(); }

  return (
    <div role="dialog" aria-label={`${a.name} application`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 100%)', height: '100%', overflowY: 'auto', borderRadius: 0, margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{a.name}</h2><button className="btn" onClick={onClose}>Close</button></div>
        <p style={{ margin: '6px 0' }}><Tag spoken={a.spoken_to} />{a.spoken_to && a.spoken_at ? <span className="hint"> {fmt(a.spoken_at)}{a.spoken_by ? ` · ${a.spoken_by}` : ''}</span> : null}{' '}
          <button className="btn" onClick={toggleSpoken}>{a.spoken_to ? 'Mark not spoken to' : 'Mark spoken to'}</button></p>
        <table style={{ fontSize: 13.5, borderCollapse: 'collapse' }}><tbody>
          {[['Phone', a.phone], ['Email', a.email], ['City', a.city], ['Experience', a.experience], ['Apprenticeship', a.apprenticeship ? 'Yes' : 'No'], ['Heard about us', a.heard_from], ['Applied', fmt(a.created_at)]]
            .map(([k, v]) => <tr key={k}><td className="hint" style={{ padding: '2px 12px 2px 0' }}>{k}</td><td>{v || '—'}</td></tr>)}
        </tbody></table>
        {a.about && <p style={{ fontSize: 13.5 }}><b>About them:</b><br />{a.about}</p>}
        <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Column <select value={a.status} onChange={(e) => onMove(e.target.value)}>{WORKSHOP_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {a.status !== 'junk' && <button className="btn" onClick={() => { if (confirm('Mark this applicant as junk?')) onMove('junk'); }}>Mark as junk</button>}
        </p>
        <h3 style={{ marginBottom: 6 }}>What was discussed</h3>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type of note">{NOTE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="What did you talk about? Questions, concerns, next step…" aria-label="Note" style={{ width: '100%', marginTop: 6 }} />
        {err && <p role="alert" style={{ color: 'var(--red, #c33)', margin: '4px 0' }}>{err}</p>}
        <button className="btn" disabled={busy || !body.trim()} onClick={save}>Save note</button>
        {kind === 'spoke' && <span className="hint"> Saving this also marks them as spoken to.</span>}
        <div style={{ marginTop: 12 }}>
          {notes === null ? <p className="hint">Loading…</p> : !notes.length ? <p className="hint">No notes yet.</p> : notes.map((n) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '8px 0', fontSize: 13.5 }}>
              <div className="hint">{(NOTE_KINDS.find(([k]) => k === n.kind) || [])[1]} · {fmt(n.created_at)}{n.by_name ? ` · ${n.by_name}` : ''}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
