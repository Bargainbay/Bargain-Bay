'use client';
import { useEffect, useState } from 'react';

const when = (d) => new Date(d).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

export function tieText(t) {
  const out = [];
  if (t?.orderNumber) out.push(`Order ${t.orderNumber}`);
  if (t?.listingSku) out.push(`Listing ${t.listingSku}${t.listingTitle ? ` — ${t.listingTitle}` : ''}`);
  if (t?.claimId) out.push(`Claim on ${t.claimSku || ''}${t.claimOrderNumber ? ` (${t.claimOrderNumber})` : ''}`.trim());
  return out.join(' · ');
}

export default function VendorMessages({ initial, ties, openId = null, limits }) {
  const [threads, setThreads] = useState(initial);
  const [open, setOpen] = useState(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ subject: '', body: '', tie: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() { const d = await (await fetch('/api/vendor/messages')).json(); if (d.threads) setThreads(d.threads); }
  async function openThread(id) {
    setErr('');
    const res = await fetch(`/api/vendor/messages?id=${id}`); const d = await res.json();
    if (!res.ok) { setErr(d.error || 'Could not open that conversation.'); return; }
    setOpen(d.thread); setComposing(false); refresh();
  }
  useEffect(() => { if (openId) openThread(openId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openId]);

  async function post(body) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/vendor/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); return null; }
      return d;
    } catch { setErr('Network error — please try again.'); return null; } finally { setBusy(false); }
  }
  async function start() {
    const [kind, id] = form.tie.split(':');
    const ties = kind && id ? { [{ order: 'vendorOrderId', listing: 'listingId', claim: 'claimId' }[kind]]: Number(id) } : {};
    const d = await post({ action: 'start', subject: form.subject, body: form.body, ...ties });
    if (d) { setForm({ subject: '', body: '', tie: '' }); await refresh(); await openThread(d.id); }
  }
  async function send() {
    const d = await post({ action: 'reply', id: open.id, body: reply });
    if (d) { setReply(''); await openThread(open.id); }
  }

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      <div className="panel" style={{ fontSize: 14 }}>
        Message the Bargain Bay team about an order, a listing or a claim. Replies appear here and we email you when there is one.
        Text only — attachments are not supported yet. Please never put a customer's personal details in a message.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(0, 2fr)', gap: 16, alignItems: 'start' }}>
        <div>
          <button className="btn primary" style={{ marginBottom: 8 }} onClick={() => { setComposing(true); setOpen(null); }}>New message</button>
          {threads.length === 0 && <div className="panel">No conversations yet.</div>}
          {threads.map((t) => (
            <div key={t.id} className="panel" style={{ cursor: 'pointer', borderLeft: t.unread ? '4px solid var(--accent, #2563eb)' : undefined, opacity: t.status === 'closed' ? 0.7 : 1 }} onClick={() => openThread(t.id)}>
              <div style={{ fontWeight: t.unread ? 700 : 500 }}>{t.subject} {t.unread && <span className="pill warn">New</span>} {t.status === 'closed' && <span className="pill">Closed</span>}</div>
              {tieText(t.tie) && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tieText(t.tie)}</div>}
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t.preview}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{when(t.lastMessageAt)}</div>
            </div>
          ))}
        </div>
        <div>
          {composing && (
            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 17 }}>New message</h2>
              <input placeholder="Subject" maxLength={limits.subject} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
              <select value={form.tie} onChange={(e) => setForm({ ...form, tie: e.target.value })} style={{ width: '100%', marginBottom: 8 }}>
                <option value="">Not about a specific order, listing or claim</option>
                {ties.orders.length > 0 && <optgroup label="Orders">{ties.orders.map((o) => <option key={o.id} value={`order:${o.id}`}>{o.label}</option>)}</optgroup>}
                {ties.listings.length > 0 && <optgroup label="Listings">{ties.listings.map((o) => <option key={o.id} value={`listing:${o.id}`}>{o.label}</option>)}</optgroup>}
                {ties.claims.length > 0 && <optgroup label="Claims">{ties.claims.map((o) => <option key={o.id} value={`claim:${o.id}`}>{o.label}</option>)}</optgroup>}
              </select>
              <textarea rows={6} maxLength={limits.body} placeholder="Your message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ width: '100%' }} />
              <button className="btn primary" disabled={busy || !form.subject.trim() || !form.body.trim()} onClick={start}>Send</button>
            </div>
          )}
          {open && (
            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 17 }}>{open.subject} {open.status === 'closed' && <span className="pill">Closed</span>}</h2>
              {tieText(open.tie) && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>About: {tieText(open.tie)}</div>}
              {open.messages.map((m) => (
                <div key={m.id} style={{ margin: '10px 0', padding: 10, borderRadius: 8, background: m.mine ? 'var(--okbg, #eef6ff)' : 'var(--bg2, #f4f4f5)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.mine ? `You (${m.from})` : m.from} · {when(m.at)}</div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{m.body}</div>
                </div>
              ))}
              <textarea rows={4} maxLength={limits.body} placeholder={open.status === 'closed' ? 'Replying reopens this conversation' : 'Write a reply'} value={reply} onChange={(e) => setReply(e.target.value)} style={{ width: '100%' }} />
              <button className="btn primary" disabled={busy || !reply.trim()} onClick={send}>Reply</button>
            </div>
          )}
          {!composing && !open && <div className="panel">Choose a conversation, or start a new one.</div>}
        </div>
      </div>
    </div>
  );
}
