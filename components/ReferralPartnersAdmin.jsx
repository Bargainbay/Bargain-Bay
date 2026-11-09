'use client';
import { useEffect, useState } from 'react';

const api = '/api/admin/referral-partners';
const post = (body) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

export default function ReferralPartnersAdmin() {
  const [partners, setPartners] = useState([]);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ email: '', name: '', pct: '10' });
  const [pick, setPick] = useState('');          // partner email whose clients are being added
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);

  async function load() { const r = await fetch(api).then((x) => x.json()).catch(() => ({})); setPartners(r.partners || []); }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(async () => { const r = await fetch(`${api}?find=${encodeURIComponent(q)}`).then((x) => x.json()).catch(() => ({})); setFound(r.customers || []); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function save(e) {
    e.preventDefault(); setMsg('');
    const r = await post({ action: 'save', ...f });
    setMsg(r.ok ? 'Saved.' : r.error || 'Could not save.'); if (r.ok) { setF({ email: '', name: '', pct: '10' }); load(); }
  }
  async function assign(c, partner) {
    const reason = partner ? 'Partner referral client' : 'Removed from partner';
    const r = await post({ action: 'assign', customerId: c.id, partner, reason });
    setMsg(r.ok ? (partner ? `${c.name || c.email} is now under ${partner}.` : 'Removed.') : r.error || 'Could not assign.');
    if (r.ok) { load(); setFound((x) => x.map((y) => (y.id === c.id ? { ...y, partner_email: partner || null } : y))); }
  }
  async function revoke(email) {
    if (!confirm(`Stop ${email} being a referral partner? Their clients stay linked but they lose access.`)) return;
    const r = await post({ action: 'revoke', email }); setMsg(r.ok ? 'Revoked.' : r.error || 'Could not revoke.'); load();
  }

  return (
    <div>
      {msg && <div className="panel" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Add or change a referral partner</h2>
        <form onSubmit={save} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Login email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="% of profit" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} style={{ width: 110 }} />
          <button className="btn btn-primary" type="submit">Save</button>
        </form>
        <p className="hint" style={{ marginBottom: 0 }}>They sign in with an ordinary account on that email (sign up at /signup, or use forgot password) and land on /partner.</p>
      </div>
      {partners.map((p) => (
        <div className="panel" key={p.email} style={{ marginBottom: 12, opacity: p.revoked_at ? 0.55 : 1 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ flex: 1 }}>{p.name || p.email} <span className="hint">{p.email} · {p.pct}% of profit · {p.clients} client{p.clients === 1 ? '' : 's'}{p.revoked_at ? ' · revoked' : ''}</span></strong>
            {!p.revoked_at && <>
              <a className="btn" href={`/partner?as=${encodeURIComponent(p.email)}`} target="_blank" rel="noreferrer">See their page</a>
              <button className="btn" onClick={() => { setPick(pick === p.email ? '' : p.email); setQ(''); }}>Add clients</button>
              <button className="btn" onClick={() => revoke(p.email)}>Revoke</button>
            </>}
          </div>
          {pick === p.email && (
            <div style={{ marginTop: 10 }}>
              <input placeholder="Search customers by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', maxWidth: 420 }} />
              {found.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ flex: 1 }}>{c.name || c.email} <span className="hint">{c.email} {c.phone} {c.partner_email ? `· under ${c.partner_email}` : ''}</span></span>
                  {c.partner_email === p.email ? <button className="btn" onClick={() => assign(c, '')}>Remove</button> : <button className="btn btn-primary" onClick={() => assign(c, p.email)}>Put under {p.name || p.email}</button>}
                </div>))}
              {q.trim().length >= 2 && found.length === 0 && <p className="hint">No customer found. A client who has never ordered or signed up is not a customer yet.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
