'use client';
import { useEffect, useState } from 'react';
import { SEGMENTS } from '../lib/lead-rules';

const SEG = Object.fromEntries(SEGMENTS);

// Owner only, on /sales/team: bring RS Ops' sales-CRM leads into the Hub, once.
// Preview first (writes nothing), then commit in batches until done; the last batch
// locks RS Ops' lead screens. See lib/rsops-leads.js.
const STAGE = { new: 'New', contacted: 'Contacted', conversation: 'Conversation', proposal: 'Proposal / quote sent' };

export default function RsopsLeadImport({ reps = [] }) {
  const john = reps.find((r) => /john/i.test(r.name || '') || /john/i.test(r.owner)) || reps[0];
  const [owner, setOwner] = useState('pool');   // the pool, then dealt out below (owner, 2026-11-12)
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [run, setRun] = useState(null);

  async function look() {
    setErr(''); setBusy('Reading RS Ops…'); setRun(null);
    try {
      const r = await fetch('/api/admin/rsops-leads', { cache: 'no-store' });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Could not read RS Ops.');
      setPreview(b);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  async function go() {
    setErr('');
    const tally = { imported: 0, dnc: 0, already: 0, duplicate: 0, skipped: 0, failed: 0 };
    let offset = 0, failures = [], duplicates = [], locked = null, total = preview?.total || 0;
    try {
      for (;;) {
        setBusy(`Bringing leads across… ${offset} of ${total}`);
        const r = await fetch('/api/admin/rsops-leads', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'commit', offset, ownerEmail: owner === 'pool' ? '' : owner, failedSoFar: tally.failed })
        });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || 'A batch failed.');
        for (const k of Object.keys(tally)) tally[k] += b.counts[k] || 0;
        failures = failures.concat(b.failures || []);
        duplicates = duplicates.concat(b.duplicates || []);
        total = b.total; offset = b.nextOffset; locked = b.locked;
        setRun({ tally: { ...tally }, failures, duplicates, locked, done: b.done, total });
        if (b.done) break;
      }
    } catch (e) {
      setErr(`${e.message} Nothing already brought across is lost — press the button again and it carries on.`);
    } finally { setBusy(''); }
  }

  async function reopen() {
    if (!confirm('Unlock the lead screens in RS Ops? The leads already brought across stay in the Hub.')) return;
    setBusy('Unlocking…');
    try {
      const r = await fetch('/api/admin/rsops-leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Could not unlock.');
      setPreview(null); setRun(null);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  const p = preview;
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Bring in the RS Ops leads</h3>
      <p className="hint">
        Moves the open leads from the RS Ops sales CRM into this Hub, once, with their call history and email-consent notes.
        Won, lost and archived leads stay in RS Ops. Leads marked Do not contact come across closed and unassigned, so nobody adds them again.
        When the last one is in, RS Ops' lead screens become read-only and stop sending lead emails.
      </p>
      {!p && <button className="btn" disabled={!!busy} onClick={look}>{busy || 'Preview what would come across'}</button>}

      {p && !run?.done && (
        <div>
          {p.movedTo && <p className="hint" style={{ color: '#b45309' }}>RS Ops says its leads were already moved on {String(p.movedTo.at || '').slice(0, 10)}. Running it again only adds what is not here yet.</p>}
          <ul style={{ lineHeight: 1.7 }}>
            <li><b>{p.toImport}</b> open leads to bring across</li>
            <li><b>{p.dnc}</b> marked Do not contact (closed, unassigned)</li>
            {p.already > 0 && <li><b>{p.already}</b> already brought across</li>}
            <li><b>{p.duplicates.length}</b> the Hub already has (left where they are, with their current owner)</li>
            {Object.entries(p.skipped).map(([why, n]) => <li key={why}><b>{n}</b> staying in RS Ops: {why}</li>)}
          </ul>
          {p.sample.length > 0 && (
            <details><summary className="hint">First few</summary>
              <ul>{p.sample.map((s, i) => <li key={i}>{s.name} — {STAGE[s.stage] || s.stage}{s.history ? `, ${s.history} history entries` : ''}{s.nextStepAt ? `, next step ${s.nextStepAt}` : ''}</li>)}</ul>
            </details>
          )}
          {p.duplicates.length > 0 && (
            <details><summary className="hint">Already in the Hub</summary>
              <ul>{p.duplicates.slice(0, 50).map((d, i) => <li key={i}>{d.name} — {d.owner}</li>)}</ul>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label>Put them in{' '}
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="pool">the unassigned pool (then give a rep a batch below)</option>
                {reps.map((r) => <option key={r.owner} value={r.owner}>{r.name || r.owner}: all of them</option>)}
              </select>
            </label>
            <button className="btn" disabled={!!busy || !(p.toImport + p.dnc)} onClick={go}>
              {busy || `Bring ${p.toImport + p.dnc} leads across`}
            </button>
          </div>
          {owner !== 'pool' && <p className="hint">Each lead {owner} converts into a new customer becomes their account for life under the commission plan.</p>}
        </div>
      )}

      {run && (
        <div style={{ marginTop: 10 }}>
          <p><b>{run.tally.imported}</b> brought across to {owner === 'pool' ? 'the unassigned pool' : owner}, <b>{run.tally.dnc}</b> do-not-contact closed,
            {' '}<b>{run.tally.duplicate}</b> already in the Hub, <b>{run.tally.already}</b> brought across earlier{run.tally.failed ? <>, <b style={{ color: '#b91c1c' }}>{run.tally.failed} failed</b></> : null}.</p>
          {run.done && run.locked && <p style={{ color: '#15803d' }}>Done. RS Ops' lead screens are now read-only.</p>}
          {run.done && !run.locked && <p style={{ color: '#b45309' }}>Finished, but RS Ops was NOT locked because some leads failed. Fix them and press the button again.</p>}
          {run.failures.length > 0 && <ul>{run.failures.slice(0, 30).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul>}
          {run.done && <p><a href="/sales/leads">Open the leads</a></p>}
        </div>
      )}
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}
      <DealLeads reps={reps} defaultOwner={john?.owner || ''} refreshKey={run?.done ? 1 : 0} />
      {(p?.movedTo || run?.locked) && <button className="btn" style={{ marginTop: 8 }} disabled={!!busy} onClick={reopen}>Unlock RS Ops lead screens</button>}
    </div>
  );
}

// Give one rep a workable slice of the RS Ops leads in the pool: N per category, capped in all.
function DealLeads({ reps, defaultOwner, refreshKey }) {
  const [counts, setCounts] = useState(null);
  const [owner, setOwner] = useState(defaultOwner);
  const [per, setPer] = useState(30);
  const [max, setMax] = useState(200);
  const [resto, setResto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/rsops-leads?view=pool', { cache: 'no-store' });
      if (r.ok) setCounts(await r.json());
    } catch {}
  }
  useEffect(() => { load(); }, [refreshKey]);

  const waiting = (counts?.segments || []).reduce((a, s) => a + s.n, 0);
  if (!counts || (!waiting && !(counts.held || []).length)) return null;
  const held = (counts.held || []).find((h) => h.owner === owner);

  async function deal() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/rsops-leads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'deal', ownerEmail: owner, perSegment: per, max, includeRestoration: resto })
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Could not assign them.');
      const parts = Object.entries(b.bySegment).map(([k, n]) => `${n} ${SEG[k] || k}`).join(', ');
      setMsg(`Gave ${b.assigned} leads to ${owner}${parts ? `: ${parts}` : ''}.`);
      await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 14, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>Give a rep a batch</h4>
      <p className="hint">{waiting} RS Ops leads are waiting in the pool. Each press takes up to the number below from every category,
        warmest first (furthest along, then a dated next step, then anyone RS Ops already spoke to). Press again when they are through them.</p>
      {waiting > 0 && <ul className="hint" style={{ columns: 2, margin: '4px 0 8px' }}>
        {counts.segments.map((s) => <li key={s.segment}>{SEG[s.segment] || s.segment}: {s.n}{s.segment === 'restoration' ? ' (pitch on hold)' : ''}</li>)}
      </ul>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>To <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          {reps.map((r) => <option key={r.owner} value={r.owner}>{r.name || r.owner}</option>)}
        </select></label>
        <label>Per category <input type="number" min="1" max="50" value={per} style={{ width: 64 }} onChange={(e) => setPer(Number(e.target.value))} /></label>
        <label>At most <input type="number" min="1" max="200" value={max} style={{ width: 72 }} onChange={(e) => setMax(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={resto} onChange={(e) => setResto(e.target.checked)} /> include restoration</label>
        <button className="btn" disabled={busy || !owner || !waiting} onClick={deal}>{busy ? 'Assigning…' : 'Give them this batch'}</button>
      </div>
      {held && <p className="hint">{owner} already holds {held.open} RS Ops leads, {held.untouched} never contacted.</p>}
      {msg && <p>{msg}</p>}
    </div>
  );
}
