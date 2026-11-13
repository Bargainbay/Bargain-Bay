'use client';
import { useEffect, useState } from 'react';
import { WANTS, HOW_REACHED } from '../lib/partner-lead-rules';

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
  const admin = role === 'admin';

  const load = async () => {
    const r = await fetch(`${api}${admin ? '?overview=1' : ''}`).then((x) => x.json()).catch(() => ({}));
    setData(r.leads ? r : { leads: [], notices: [], error: r.error });
  };
  useEffect(() => { load(); }, []);

  async function send(e) {
    e.preventDefault(); setBusy(true); setRes(null);
    const r = await call({ action: 'submit', ...f });
    setBusy(false); setRes(r);
    if (r.ok) setF(empty);
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

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Send a lead</h2>
        <p className="hint" style={{ marginTop: 0 }}>Only someone who contacted <b>you</b>. Double-check the phone number: it is the only way we can reach them.</p>
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
              <thead><tr><th>Name</th><th>Sent</th><th>With our team</th><th>Reached</th><th>Sold</th><th>Completed</th><th>Unreachable</th><th>Junk</th><th>Duplicates</th><th>Last sent</th></tr></thead>
              <tbody>{data.overview.generators.map((g) => (
                <tr key={g.email}><td>{g.name}<div className="hint" style={{ fontSize: 11.5 }}>{g.email}</div></td><td>{g.sent}</td><td>{g.withTeam}</td><td>{g.called}</td><td>{g.sold}</td><td>{g.completed}</td><td>{g.unreachable}</td><td>{g.notCounted}</td><td>{g.dups}</td><td>{fmt(g.last)}</td></tr>))}</tbody>
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
