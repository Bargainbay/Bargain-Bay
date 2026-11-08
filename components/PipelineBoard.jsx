'use client';
import { useState } from 'react';
import { STAGES, OPEN_STAGES, LOST_REASONS } from '../lib/lead-rules';

// The deal board: one column per open stage, each with its total estimated value.
// Cards move with the arrows (a phone, one thumb) and can also be dragged on a desktop.
// WON is not a column you can drop onto: a deal is Won when its payment is recorded.
// LOST asks why, because "lost" with no reason teaches nothing.
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA');
const label = (k) => (STAGES.find(([s]) => s === k) || [])[1] || k;

export default function PipelineBoard({ initial }) {
  const [leads, setLeads] = useState(initial);
  const [err, setErr] = useState('');
  const [losing, setLosing] = useState(null); // lead id awaiting a reason
  const [reason, setReason] = useState('');

  async function move(id, stage, lostReason) {
    setErr('');
    const prev = leads;
    setLeads((xs) => xs.map((l) => (l.id === id ? { ...l, stage, lost_reason: lostReason || null } : l)));
    const r = await fetch('/api/sales/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stage', id, stage, lostReason }) });
    if (!r.ok) { setLeads(prev); setErr((await r.json().catch(() => ({}))).error || 'That did not work.'); }
  }

  const col = (stage) => leads.filter((l) => l.stage === stage);
  const idx = (s) => OPEN_STAGES.indexOf(s);
  const won = leads.filter((l) => l.stage === 'won');
  const lost = leads.filter((l) => l.stage === 'lost');

  return (
    <div>
      {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
      {losing && (
        <div className="panel" role="dialog" aria-label="Why was it lost">
          <b>Why was it lost?</b>{' '}
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"><option value="">Pick one…</option>{LOST_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
          <button className="btn" disabled={!reason} onClick={() => { move(losing, 'lost', reason); setLosing(null); setReason(''); }}>Mark lost</button>{' '}
          <button className="btn" onClick={() => { setLosing(null); setReason(''); }}>Cancel</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {OPEN_STAGES.map((stage) => {
          const cards = col(stage);
          const total = cards.reduce((a, l) => a + (Number(l.est_value) || 0), 0);
          return (
            <section key={stage} aria-label={label(stage)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = Number(e.dataTransfer.getData('text/plain')); if (id) move(id, stage); }}
              style={{ flex: '0 0 250px', background: 'var(--panel-alt, #f4f4f4)', borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b style={{ fontSize: 14 }}>{label(stage)}</b><span className="hint">{cards.length} · {money(total)}</span>
              </div>
              {cards.map((l) => (
                <div key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(l.id))}
                  style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: 8, marginTop: 8, fontSize: 13.5 }}>
                  <a href={`/sales/leads?open=${l.id}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{l.company || l.contact_name}</a>
                  <div className="hint">{l.temperature}{l.est_value != null ? ` · ${money(l.est_value)}` : ''}{l.next_step_at ? ` · next ${l.next_step_at}` : ''}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn" style={{ fontSize: 12 }} disabled={idx(stage) === 0} aria-label={`Move ${l.company || l.contact_name} back`} onClick={() => move(l.id, OPEN_STAGES[idx(stage) - 1])}>←</button>
                    <button className="btn" style={{ fontSize: 12 }} disabled={idx(stage) === OPEN_STAGES.length - 1} aria-label={`Move ${l.company || l.contact_name} forward`} onClick={() => move(l.id, OPEN_STAGES[idx(stage) + 1])}>→</button>
                    <button className="btn" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => setLosing(l.id)}>Lost</button>
                  </div>
                </div>
              ))}
              {cards.length === 0 && <p className="hint" style={{ margin: '8px 0 0' }}>Nothing here.</p>}
            </section>
          );
        })}
      </div>
      <p className="hint">
        Won (paid): <b>{won.length}</b> · Lost: <b>{lost.length}</b>. A deal becomes Won when its payment is recorded, not by moving it here.
      </p>
    </div>
  );
}
