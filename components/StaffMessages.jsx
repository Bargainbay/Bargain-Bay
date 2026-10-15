'use client';
import { useState } from 'react';
import { contactDetailsIn, contactWarning } from '../lib/contact-guard';
import { tieText } from './VendorMessages';

const when = (d) => new Date(d).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
const FILTERS = [['open', 'Open'], ['awaiting_us', 'Awaiting us'], ['awaiting_vendor', 'Awaiting seller'], ['closed', 'Closed'], ['all', 'All']];

// Staff inbox for seller conversations. An "internal note" is for staff only: it is stored with the thread but
// the seller's API never selects it. A seller-visible message that looks like it has a customer's email or phone
// asks for a confirmation first (the server enforces the same check).
export default function StaffMessages({ vendors, initial, me }) {
  const [filter, setFilter] = useState('open');
  const [threads, setThreads] = useState(initial);
  const [open, setOpen] = useState(null);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ vendorId: '', subject: '', body: '', tie: '' });
  const [ties, setTies] = useState({ orders: [], listings: [], claims: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || 'That did not work.'); e.needsConfirm = d.needsConfirm; throw e; }
    return d;
  }
  async function load(f = filter) { const d = await api('GET', `/api/admin/marketplace/messages?filter=${f}`); setThreads(d.threads); }
  async function openThread(id) {
    setErr(''); setComposing(false);
    try { setOpen((await api('GET', `/api/admin/marketplace/messages?id=${id}`)).thread); load(); } catch (e) { setErr(e.message); }
  }
  async function run(fn) { setBusy(true); setErr(''); try { return await fn(); } catch (e) { setErr(e.message); return null; } finally { setBusy(false); } }

  // Warn before a seller-visible message goes out with what looks like customer contact details.
  const confirmed = (body, isInternal) => {
    if (isInternal) return false;
    const found = contactDetailsIn(body);
    if (!found.length) return false;
    if (!window.confirm(contactWarning(found))) throw new Error('Not sent.');
    return true;
  };

  async function send() {
    await run(async () => {
      const confirmContact = confirmed(text, internal);
      await api('POST', '/api/admin/marketplace/messages', { action: 'reply', id: open.id, body: text, internal, confirmContact });
      setText(''); setInternal(false); await openThread(open.id);
    });
  }
  async function start() {
    await run(async () => {
      const confirmContact = confirmed(form.body, false);
      const [kind, id] = form.tie.split(':');
      const tie = kind && id ? { [{ order: 'vendorOrderId', listing: 'listingId', claim: 'claimId' }[kind]]: Number(id) } : {};
      const d = await api('POST', '/api/admin/marketplace/messages', { action: 'start', vendorId: Number(form.vendorId), subject: form.subject, body: form.body, confirmContact, ...tie });
      setForm({ vendorId: '', subject: '', body: '', tie: '' }); await load(); await openThread(d.id);
    });
  }
  const act = (action, extra = {}) => run(async () => { await api('POST', '/api/admin/marketplace/messages', { action, id: open.id, ...extra }); await openThread(open.id); });
  async function pickVendor(id) {
    setForm((f) => ({ ...f, vendorId: id, tie: '' }));
    if (id) { try { setTies((await api('GET', `/api/admin/marketplace/messages?ties=${id}`)).ties); } catch { /* ties are optional */ } }
  }

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map(([k, label]) => <button key={k} className={`btn${filter === k ? ' primary' : ''}`} onClick={() => { setFilter(k); load(k); }}>{label}</button>)}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => { setComposing(true); setOpen(null); }}>New message to a seller</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', gap: 16, alignItems: 'start' }}>
        <div>
          {threads.length === 0 && <div className="panel">Nothing here.</div>}
          {threads.map((t) => (
            <div key={t.id} className="panel" style={{ cursor: 'pointer', borderLeft: t.unread ? '4px solid var(--accent, #2563eb)' : undefined }} onClick={() => openThread(t.id)}>
              <div style={{ fontWeight: t.unread ? 700 : 500 }}>{t.vendor} — {t.subject}</div>
              {tieText(t.tie) && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tieText(t.tie)}</div>}
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t.preview}</div>
              <div style={{ fontSize: 12 }}>
                {t.status === 'closed' ? <span className="pill">Closed</span> : t.lastPublicSide === 'vendor' ? <span className="pill warn">Awaiting us</span> : <span className="pill ok">Awaiting seller</span>}
                {t.assignedTo && <span style={{ marginLeft: 6, color: 'var(--muted)' }}>{t.assignedTo}</span>} · {when(t.lastMessageAt)}
              </div>
            </div>
          ))}
        </div>
        <div>
          {composing && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>New message to a seller</h3>
              <select value={form.vendorId} onChange={(e) => pickVendor(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
                <option value="">Choose a seller…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.trade_name || v.legal_name}</option>)}
              </select>
              <input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
              {form.vendorId && (
                <select value={form.tie} onChange={(e) => setForm({ ...form, tie: e.target.value })} style={{ width: '100%', marginBottom: 8 }}>
                  <option value="">Not tied to an order, listing or claim</option>
                  {ties.orders.map((o) => <option key={`o${o.id}`} value={`order:${o.id}`}>Order {o.label}</option>)}
                  {ties.listings.map((o) => <option key={`l${o.id}`} value={`listing:${o.id}`}>Listing {o.label}</option>)}
                  {ties.claims.map((o) => <option key={`c${o.id}`} value={`claim:${o.id}`}>{o.label}</option>)}
                </select>)}
              <textarea rows={5} placeholder="Message (the seller sees this — never paste a customer's email or phone)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ width: '100%' }} />
              <button className="btn primary" disabled={busy || !form.vendorId || !form.subject.trim() || !form.body.trim()} onClick={start}>Send</button>
            </div>
          )}
          {open && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{open.vendor} — {open.subject} {open.status === 'closed' && <span className="pill">Closed</span>}</h3>
              {tieText(open.tie) && <div style={{ fontSize: 13, color: 'var(--muted)' }}>About: {tieText(open.tie)}</div>}
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy} onClick={() => act('assign', { to: open.assignedTo === me ? '' : me })}>{open.assignedTo === me ? 'Unassign me' : 'Assign to me'}</button>
                {open.assignedTo && open.assignedTo !== me && <span style={{ alignSelf: 'center', fontSize: 13 }}>Assigned to {open.assignedTo}</span>}
                {open.status === 'open' ? <button className="btn" disabled={busy} onClick={() => act('close')}>Close</button> : <button className="btn" disabled={busy} onClick={() => act('reopen')}>Reopen</button>}
              </div>
              {open.messages.map((m) => (
                <div key={m.id} style={{ margin: '10px 0', padding: 10, borderRadius: 8, background: m.internal ? '#fff7d6' : m.side === 'vendor' ? 'var(--bg2, #f4f4f5)' : 'var(--okbg, #eef6ff)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {m.internal && <b>INTERNAL NOTE — the seller cannot see this · </b>}{m.side === 'vendor' ? `${open.vendor}: ` : ''}{m.from} · {when(m.at)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{m.body}</div>
                </div>
              ))}
              <textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%', background: internal ? '#fff7d6' : undefined }}
                placeholder={internal ? 'Internal note — only staff see this' : 'Reply to the seller'} />
              <label style={{ fontSize: 13, display: 'block', margin: '4px 0' }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (staff only)</label>
              <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>{internal ? 'Save note' : 'Send to seller'}</button>
            </div>
          )}
          {!composing && !open && <div className="panel">Choose a conversation.</div>}
        </div>
      </div>
    </div>
  );
}
