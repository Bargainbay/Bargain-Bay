'use client';
import { useEffect, useState } from 'react';

const api = '/api/admin/partner-leads';
const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const KINDS = [['call', 'Call'], ['text', 'Text'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['meeting', 'Meeting'], ['note', 'Note']];
const OUTCOMES = [['', 'No outcome'], ['no_answer', 'No answer'], ['voicemail', 'Voicemail'], ['conversation', 'Spoke with them'], ['meeting_booked', 'Meeting booked'], ['proposal_sent', 'Quote sent'], ['not_interested', 'Not interested']];
const LOST = [['not_interested', 'Not interested'], ['no_response', "Couldn't reach"], ['wrong_number', 'Wrong number'], ['price', 'Price'], ['has_vendor', 'Has a vendor'], ['no_need', 'No need'], ['other', 'Other']];

function Work({ lead, onDone }) {
  const [f, setF] = useState({ kind: 'call', outcome: '', notes: '' });
  const [lost, setLost] = useState('not_interested');
  const [msg, setMsg] = useState('');
  const run = async (body, ok) => { setMsg(''); const r = await post({ id: lead.id, ...body }); if (!r.ok) setMsg(r.error || 'Failed.'); else { setMsg(ok); onDone(); } };
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e5e5' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input placeholder="Internal note (the sender never sees it)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn btn-primary" onClick={() => run({ action: 'activity', ...f }, 'Logged.')}>Log it</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn" onClick={() => run({ action: 'convert' }, 'They are now a customer. Build the quote or invoice as usual.')}>Make them a customer</button>
        <select value={lost} onChange={(e) => setLost(e.target.value)}>{LOST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn" onClick={() => run({ action: 'stage', stage: 'lost', lostReason: lost }, 'Closed.')}>Close as lost</button>
        <button className="btn" onClick={() => { if (confirm('Mark as junk? Use this for a fake number or somebody who never contacted the generator. It counts against the generator.')) run({ action: 'junk' }, 'Marked junk.'); }}>Junk</button>
      </div>
      {msg && <p className="hint" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}

function Card({ l, claim, work, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 16 }}>{l.name}</strong>
        {l.phone && <a href={`tel:${l.phone}`} style={{ textDecoration: 'underline' }}>{l.phone}</a>}
        {l.email && <a href={`mailto:${l.email}`} style={{ textDecoration: 'underline' }}>{l.email}</a>}
        <span className="hint" style={{ flex: 1 }}>{l.wants} · reached the generator by {String(l.howReached || '').replace('_', ' ')} · waiting {ago(l.submittedAt)}</span>
        {claim && <button className="btn btn-primary" onClick={claim}>Claim</button>}
        {work && <button className="btn" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Work it'}</button>}
      </div>
      <div className="hint" style={{ marginTop: 4 }}>From {l.sender}{l.org ? ` (${l.org})` : ''}{l.owner && !work ? ` · with ${l.owner}` : ''}{l.stage !== 'new' ? ` · ${l.stage}` : ''}</div>
      {l.note && <div style={{ fontSize: 13.5, marginTop: 4 }}>{l.note}</div>}
      {work && open && <Work lead={l} onDone={onDone} />}
    </div>
  );
}

export default function PartnerLeadQueue() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const load = async () => { const r = await fetch(api).then((x) => x.json()).catch(() => ({})); setData(r.unclaimed ? r : { unclaimed: [], mine: [], others: [], error: r.error }); };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  async function claim(id) { setMsg(''); const r = await post({ action: 'claim', id }); setMsg(r.ok ? 'Yours. Call them.' : r.error || 'Could not claim.'); load(); }
  if (!data) return <p className="hint">Loading…</p>;
  return (
    <div>
      {data.error && <div className="panel">{data.error}</div>}
      {msg && <div className="panel" style={{ marginBottom: 10 }}>{msg}</div>}
      <h2 style={{ fontSize: 18 }}>Waiting to be claimed ({data.unclaimed.length})</h2>
      {data.unclaimed.length === 0 && <p className="hint">Nothing is waiting. New leads appear here and in an email.</p>}
      {data.unclaimed.map((l) => <Card key={l.id} l={l} claim={() => claim(l.id)} onDone={load} />)}
      <h2 style={{ fontSize: 18, marginTop: 22 }}>Yours ({data.mine.length})</h2>
      {data.mine.length === 0 && <p className="hint">You have not claimed any yet.</p>}
      {data.mine.map((l) => <Card key={l.id} l={l} work onDone={load} />)}
      {data.others.length > 0 && (<>
        <h2 style={{ fontSize: 18, marginTop: 22 }}>With the rest of the team ({data.others.length})</h2>
        {data.others.map((l) => <Card key={l.id} l={l} onDone={load} />)}
      </>)}
    </div>
  );
}
