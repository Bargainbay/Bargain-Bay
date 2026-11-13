'use client';
import { useEffect, useRef, useState } from 'react';
import { compress } from './photo-pick';
import { WANTS, HOW_REACHED } from '../lib/partner-lead-rules';
import CopyLink from './CopyLink';

// A partner's lead desk. A lead generator sees only what they sent and what happened to it; an organisation admin sees the
// whole organisation's leads, each generator's numbers and the duplicates refused. Nothing here ever shows money.
const api = '/api/partner/leads';
const call = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ http: r.status, ...(await r.json().catch(() => ({}))) }));
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' }) : '—');
const GOOD = '#15803d';

function Badge({ l }) {
  const bad = ['not_interested', 'couldnt_reach', 'wrong_number', 'not_counted'].includes(l.status);
  return <span style={{ fontWeight: 700, color: l.success ? GOOD : bad ? '#7a7a7a' : '#2e2d2b' }}>{l.statusLabel}</span>;
}

export default function PartnerLeadDesk({ role }) {
  const empty = { name: '', phone: '', email: '', want: '', howReached: '', note: '' };
  const [f, setF] = useState(empty);
  const [data, setData] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState(null);            // { id, preview, candidates, warnings, message, picked }
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);
  const admin = role === 'admin';

  const load = async () => {
    const r = await fetch(`${api}${admin ? '?overview=1' : ''}`).then((x) => x.json()).catch(() => ({}));
    setData(r.leads ? r : { leads: [], notices: [], error: r.error });
  };
  useEffect(() => { load(); }, []);

  const apply = (c) => setF((cur) => ({ ...cur, name: c.name || '', phone: c.phone || '', email: c.email || '', want: c.want || cur.want, howReached: c.how || cur.howReached, note: c.note || cur.note }));

  // One picture per request, shrunk on the phone first (a serverless body is ~4.5MB). Text needs more pixels than a photo does.
  async function pickShot(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true); setRes(null); setShot(null);
    try {
      const blob = await compress(file, { max: 2200, quality: 0.85 });
      const fd = new FormData(); fd.set('file', blob, 'screenshot.jpg');
      const r = await fetch(`${api}/screenshot`, { method: 'POST', body: fd });
      const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch { /* an HTML error page */ }
      if (!r.ok || !d.screenshotId) {
        setRes({ ok: false, error: d.error || (r.status === 413 ? 'That picture is too big to send.' : 'We could not send that screenshot. Please fill in the form by hand.') });
      } else {
        const cands = d.candidates || [];
        setShot({ id: d.screenshotId, preview: URL.createObjectURL(blob), candidates: cands, warnings: d.warnings || [], message: d.message || null, picked: cands.length === 1 });
        if (cands.length === 1) apply(cands[0]);
      }
    } catch { setRes({ ok: false, error: 'That picture could not be read on your phone. Please fill in the form by hand.' }); }
    setReading(false);
  }

  async function send(e) {
    e.preventDefault(); setBusy(true); setRes(null);
    const r = await call({ action: 'submit', ...f, screenshotId: shot?.id || undefined });
    setBusy(false); setRes(r);
    if (r.ok) { setF(empty); setShot(null); }
    load();
  }
  async function dismiss() { await call({ action: 'seen' }); load(); }
  const unseen = (data?.notices || []).filter((n) => !n.seen_at);

  return (
    <div>
      {unseen.length > 0 && (
        <div className="panel" style={{ marginBottom: 12, borderLeft: '4px solid #b45309' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>New</div>
          {unseen.map((n) => <div key={n.id} style={{ fontSize: 14, padding: '2px 0' }}>{n.text}</div>)}
          <button className="btn" style={{ marginTop: 6 }} onClick={dismiss}>Got it</button>
        </div>
      )}

      {!admin && data?.mine?.code && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Your code and link</h2>
          <p className="hint" style={{ marginTop: 0 }}>Your code is <b>{data.mine.code}</b>. Shoppers who use it at bargainbay.ca get {data.mine.discountPct}% off, and the sale is credited to you. Share your link, or tell them to type the code at checkout.</p>
          <CopyLink link={data.mine.link} />
          <p className="hint" style={{ marginBottom: 0 }}>Orders from your customers so far: <b>{data.mine.orders}</b>{data.mine.delivered ? ` (${data.mine.delivered} delivered)` : ''}.</p>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Send a lead</h2>
        <p className="hint" style={{ marginTop: 0 }}>Only someone who contacted <b>you</b>. Double-check the phone number: it is the only way we can reach them.</p>
        <div style={{ marginBottom: 10 }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickShot} style={{ display: 'none' }} />
          <button type="button" className="btn" disabled={reading} onClick={() => fileRef.current?.click()}>{reading ? 'Reading your screenshot…' : 'Fill it in from a screenshot'}</button>
        </div>
        {shot && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', margin: '0 0 12px', padding: 10, background: '#fafaf7', border: '1px solid #e5e5e0', borderRadius: 8 }}>
            <img src={shot.preview} alt="Your screenshot" style={{ width: 120, maxHeight: 200, objectFit: 'contain', border: '1px solid #ddd', borderRadius: 6, background: '#fff' }} />
            <div style={{ flex: 1, minWidth: 220, fontSize: 14 }}>
              {shot.candidates.length > 0 && <div style={{ fontWeight: 700 }}>Read from your screenshot. Please check every field, especially the phone number.</div>}
              {shot.candidates.length > 1 && !shot.picked && (
                <div style={{ marginTop: 6 }}>
                  <div className="hint">There is more than one person in it. Who is this lead for?</div>
                  {shot.candidates.map((c, i) => (<button key={i} type="button" className="btn" style={{ margin: '4px 6px 0 0' }} onClick={() => { apply(c); setShot({ ...shot, picked: true }); }}>{c.name || c.phone || c.email}</button>))}
                </div>
              )}
              {shot.message && <div style={{ color: '#b45309', marginTop: 4 }}>{shot.message}</div>}
              {shot.warnings.map((w, i) => <div key={i} style={{ color: '#b45309', marginTop: 4 }}>{w}</div>)}
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setShot(null)}>Remove the screenshot</button>
            </div>
          </div>
        )}
        <form onSubmit={send} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <input placeholder="Their name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
          <input placeholder="Phone (10 digits)" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="off" />
          <input placeholder="Email (if you have it)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
          <select required value={f.want} onChange={(e) => setF({ ...f, want: e.target.value })}>
            <option value="">What do they want?</option>{WANTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select required value={f.howReached} onChange={(e) => setF({ ...f, howReached: e.target.value })}>
            <option value="">How did they reach you?</option>{HOW_REACHED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea placeholder="Anything we should know (what they asked about, where they are, best time to call)" rows={3} maxLength={600} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send lead'}</button>
        </form>
        {res?.ok && <p style={{ color: GOOD, fontWeight: 600, marginBottom: 0 }}>Sent. Our team will contact them.</p>}
        {res && !res.ok && res.duplicate === 'other' && <p style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 0 }}>{res.message}</p>}
        {res && !res.ok && res.duplicate === 'own' && <p style={{ fontWeight: 600, marginBottom: 0 }}>{res.message} {res.lead ? `${res.lead.name}: ${res.lead.statusLabel}.` : ''}</p>}
        {res && !res.ok && !res.duplicate && <p style={{ color: '#b91c1c', marginBottom: 0 }}>{res.error || 'Could not send.'}</p>}
      </div>

      {admin && data?.overview && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Your lead generators</h2>
          {data.overview.generators.length === 0 ? <p className="hint">Add your first lead generator in “Your team” above.</p> : (
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>Name</th><th>Code</th><th>Sent</th><th>With our team</th><th>Reached</th><th>Sold</th><th>Completed</th><th>Unreachable</th><th>Junk</th><th>Duplicates</th><th>Orders</th><th>Last sent</th></tr></thead>
              <tbody>{data.overview.generators.map((g) => (
                <tr key={g.email}><td>{g.name}<div className="hint" style={{ fontSize: 11.5 }}>{g.email}</div></td><td>{g.code || '—'}</td><td>{g.sent}</td><td>{g.withTeam}</td><td>{g.called}</td><td>{g.sold}</td><td>{g.completed}</td><td>{g.unreachable}</td><td>{g.notCounted}</td><td>{g.dups}</td><td>{g.orders}</td><td>{fmt(g.last)}</td></tr>))}</tbody>
            </table></div>
          )}
          {data.overview.duplicates.length > 0 && (<>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Refused as duplicates</h3>
            <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>When</th><th>Person</th><th>Sent by</th><th>Against</th></tr></thead>
              <tbody>{data.overview.duplicates.map((d, i) => (<tr key={i}><td>{fmt(d.when)}</td><td>{d.name}</td><td>{d.sender}</td><td>{d.againstOwn ? 'their own earlier lead' : d.firstSentBy ? `first sent by ${d.firstSentBy}` : d.kind}</td></tr>))}</tbody>
            </table></div>
          </>)}
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{admin ? 'All your leads' : 'What happened to your leads'}</h2>
        {!data ? <p className="hint">Loading…</p> : data.leads.length === 0 ? <p className="hint" style={{ marginBottom: 0 }}>No leads sent yet.</p> : (
          <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Person</th>{admin && <th>Sent by</th>}<th>Wants</th><th>Sent</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{data.leads.map((l) => (
              <tr key={l.id}><td>{l.name}<div className="hint" style={{ fontSize: 11.5 }}>{[l.phone, l.email].filter(Boolean).join(' · ')}</div></td>{admin && <td>{l.sender}</td>}<td>{l.wants}</td><td>{fmt(l.submittedAt)}</td><td><Badge l={l} /></td><td>{fmt(l.changedAt)}</td></tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
