'use client';
// The owner's side of the rep agreement: fill the blanks only the company can decide, open signing, see who
// has signed, and countersign for the company. Admin only (the API enforces it).
import { useEffect, useState } from 'react';

const when = (t) => new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
const call = async (body) => {
  const r = await fetch('/api/admin/rep-agreement', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, ...j } : { ok: false, error: j.error || 'That did not work.' };
};

export default function RepAgreementAdmin() {
  const [d, setD] = useState(null);
  const [f, setF] = useState({});
  const [cs, setCs] = useState({});
  const [msg, setMsg] = useState('');
  useEffect(() => { call().then((r) => { setD(r); if (r.ok) setF(r.fields); }); }, []);
  if (!d) return null;
  if (!d.ok) return <div className="error-box">{d.error}</div>;
  const apply = (r, ok) => { if (r.ok) { setD(r); setF(r.fields); setMsg(ok); } else setMsg(r.error); };
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Rep employment agreement (signed in the Sales Hub)</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        The agreement is built from the Drive draft v2 and the commission tiers above. Fill in what only the company can decide;
        until every blank is filled, signing stays closed. Both documents are still drafts for your employment lawyer.
      </p>
      {d.defs.map((def) => (
        <label key={def.key} style={{ display: 'block', marginBottom: 8, fontSize: 13.5 }}>{def.label}
          <input value={f[def.key] || ''} onChange={(e) => setF({ ...f, [def.key]: e.target.value })} />
        </label>
      ))}
      <button className="btn" onClick={async () => apply(await call({ action: 'set_fields', fields: f }), 'Saved.')}>Save details</button>
      <p style={{ fontSize: 14 }}>
        {d.unresolved.length ? <>Still blank: <b>{d.unresolved.join(' ')}</b></> : <>No blanks left.</>}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={d.open} disabled={!d.open && d.unresolved.length > 0}
          onChange={async (e) => apply(await call({ action: 'set_open', open: e.target.checked }), e.target.checked ? 'Signing is open.' : 'Signing is closed.')} />
        Signing is open (the rep sees the Sign button on My agreement)
      </label>
      {msg && <p role="status" className="hint">{msg}</p>}
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Signatures</h3>
      {d.list.length === 0 ? <p className="hint">Nobody has signed yet.</p> : d.list.map((s) => (
        <div key={`${s.email}-${s.version}`} style={{ padding: '6px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14 }}>
          <b>{s.name}</b> ({s.email}) signed {s.docs} documents on {when(s.signed_at)}.{' '}
          {s.countersigned >= s.docs ? <>Countersigned by {s.countersigned_name} on {when(s.countersigned_at)}.</> : (
            <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              Awaiting the company:
              <input style={{ width: 240 }} placeholder={d.signatory} value={cs[s.email] || ''} onChange={(e) => setCs({ ...cs, [s.email]: e.target.value })} />
              <button className="btn" onClick={async () => apply(await call({ action: 'countersign', rep: s.email, name: cs[s.email] }), 'Countersigned. Both of you were emailed the copy.')}>Countersign</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
