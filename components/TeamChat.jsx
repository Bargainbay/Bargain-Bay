'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNELS } from '../lib/team-board-rules';

// The team board: pick a channel, then Chat (the running conversation) or Posts
// (important notices people tick "Got it" on). Polls while the page is on screen;
// there is no background push, same OS limit as everything else on a phone.
const POLL_MS = 5000;
const when = (t) => new Date(t).toLocaleString('en-CA', {
  timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});

async function api(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
}
const post = (body) => api('/api/team', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

export default function TeamChat({ initialChannel = 'general' }) {
  const [info, setInfo] = useState(null);
  const [channel, setChannel] = useState(initialChannel);
  const [mode, setMode] = useState('chat');
  const [error, setError] = useState('');

  const loadSummary = useCallback(() => api('/api/team?summary=1').then(setInfo).catch(() => {}), []);
  useEffect(() => {
    loadSummary();
    const t = setInterval(loadSummary, 15000);
    return () => clearInterval(t);
  }, [loadSummary]);

  const rights = info?.rights || {};
  const mine = CHANNELS.filter((c) => rights[c.id]);
  useEffect(() => {
    if (info && !rights[channel] && mine[0]) setChannel(mine[0].id);
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <p className="hint">Loading the team board…</p>;
  if (!mine.length) return <p className="hint">You are not on any team channel yet.</p>;
  const cur = info.channels[channel] || { chat: 0, post: 0, unackedPosts: 0 };
  const badge = (n) => (n > 0 ? <span className="nav-badge" style={{ marginLeft: 6 }}>{n > 99 ? '99+' : n}</span> : null);

  return (
    <div className="team-board">
      <div className="dash-filters" role="tablist" aria-label="Channels">
        {mine.map((c) => {
          const n = info.channels[c.id] || {};
          return (
            <button key={c.id} role="tab" aria-selected={channel === c.id}
              className={`dash-filter${channel === c.id ? ' active' : ''}`} onClick={() => { setChannel(c.id); setError(''); }}>
              {c.label}{badge((n.chat || 0) + (n.post || 0))}
            </button>
          );
        })}
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>{CHANNELS.find((c) => c.id === channel)?.blurb}</p>
      <div className="dash-filters" role="tablist" aria-label="Chat or posts">
        <button className={`dash-filter${mode === 'chat' ? ' active' : ''}`} onClick={() => setMode('chat')}>Chat{badge(cur.chat)}</button>
        <button className={`dash-filter${mode === 'post' ? ' active' : ''}`} onClick={() => setMode('post')}>Posts{badge(cur.post)}</button>
      </div>
      {error && <p style={{ color: '#a33' }}>{error}</p>}
      {mode === 'chat'
        ? <Chat key={channel} channel={channel} me={info.me} rights={rights[channel]} onChange={loadSummary} setError={setError} />
        : <Posts key={channel} channel={channel} me={info.me} rights={rights[channel]} onChange={loadSummary} setError={setError} />}
    </div>
  );
}

function Chat({ channel, me, rights, onChange, setError }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(true);
  const endRef = useRef(null);
  const lastId = useRef(0);
  const stick = useRef(true);

  const markRead = useCallback((id) => {
    if (id) post({ action: 'read', channel, kind: 'chat', upTo: id }).then(onChange).catch(() => {});
  }, [channel, onChange]);

  useEffect(() => {
    let live = true;
    const first = async () => {
      try {
        const d = await api(`/api/team?channel=${channel}&kind=chat`);
        if (!live) return;
        setMsgs(d.messages); setOlder(d.messages.length >= 50);
        lastId.current = d.messages.at(-1)?.id || 0; markRead(lastId.current);
      } catch (e) { setError(e.message); }
    };
    first();
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const d = await api(`/api/team?channel=${channel}&kind=chat&after=${lastId.current}`);
        if (!live || !d.messages.length) return;
        lastId.current = d.messages.at(-1).id;
        setMsgs((m) => [...m, ...d.messages.filter((x) => !m.some((y) => y.id === x.id))]);
        markRead(lastId.current);
      } catch { /* next tick */ }
    }, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [channel, markRead, setError]);

  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  async function loadOlder() {
    try {
      const d = await api(`/api/team?channel=${channel}&kind=chat&before=${msgs[0]?.id || 0}`);
      stick.current = false;
      setMsgs((m) => [...d.messages, ...m]); setOlder(d.messages.length >= 50);
    } catch (e) { setError(e.message); }
  }
  async function send(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const d = await post({ action: 'send', channel, kind: 'chat', body: text });
      stick.current = true;
      lastId.current = Math.max(lastId.current, d.message.id);
      setMsgs((m) => (m.some((x) => x.id === d.message.id) ? m : [...m, d.message]));
      setText('');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    if (!confirm('Remove this message?')) return;
    try { await post({ action: 'delete', id }); setMsgs((m) => m.filter((x) => x.id !== id)); } catch (e) { setError(e.message); }
  }

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div style={{ height: '52vh', minHeight: 280, overflowY: 'auto', padding: 12 }}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {older && msgs.length > 0 && <button className="btn-link" onClick={loadOlder} style={{ display: 'block', margin: '0 auto 8px' }}>Older messages</button>}
        {!msgs.length && <p className="hint">Nothing here yet. Say hello.</p>}
        {msgs.map((m, i) => {
          const mineMsg = m.authorKey === me.key;
          const sameAuthor = msgs[i - 1]?.authorKey === m.authorKey;
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mineMsg ? 'flex-end' : 'flex-start', marginTop: sameAuthor ? 2 : 10 }}>
              {!sameAuthor && <div className="hint" style={{ fontSize: 11, margin: '0 4px 2px' }}>{mineMsg ? 'You' : m.authorName} · {when(m.createdAt)}</div>}
              <div style={{
                maxWidth: '85%', padding: '7px 11px', borderRadius: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14,
                background: mineMsg ? 'var(--charcoal)' : 'var(--card)', color: mineMsg ? '#fff' : 'var(--charcoal)',
                border: mineMsg ? 'none' : '1px solid var(--line-soft)'
              }}>
                {m.body}
              </div>
              {(mineMsg || rights?.moderate) && <button className="btn-link" style={{ fontSize: 11 }} onClick={() => remove(m.id)}>remove</button>}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--line-soft)' }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Message the channel"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          style={{ flex: 1, resize: 'none', padding: 8, fontSize: 16 }} />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

function Posts({ channel, me, rights, onChange, setError }) {
  const [posts, setPosts] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState({});

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/team?channel=${channel}&kind=post&limit=100`);
      setPosts(d.messages);
      const top = Math.max(0, ...d.messages.map((p) => p.id));
      if (top) post({ action: 'read', channel, kind: 'post', upTo: top }).then(onChange).catch(() => {});
    } catch (e) { setError(e.message); setPosts([]); }
  }, [channel, onChange, setError]);
  useEffect(() => { load(); }, [load]);

  async function act(body2) { try { await post(body2); await load(); onChange(); } catch (e) { setError(e.message); } }
  async function submit(e) {
    e.preventDefault(); setError('');
    try { await post({ action: 'send', channel, kind: 'post', title, body }); setTitle(''); setBody(''); setOpen(false); await load(); }
    catch (err) { setError(err.message); }
  }
  async function showSeen(id) {
    try { const d = await api(`/api/team?acks=${id}`); setSeen((s) => ({ ...s, [id]: d.acks })); } catch (e) { setError(e.message); }
  }

  return (
    <div>
      {rights?.post && (open ? (
        <form onSubmit={submit} className="panel">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title" style={{ width: '100%', padding: 8, fontSize: 16, marginBottom: 8 }} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder="The details people need to know"
            style={{ width: '100%', padding: 8, fontSize: 16 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={!title.trim() || !body.trim()}>Post</button>
            <button type="button" className="btn-link" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : <button className="btn" onClick={() => setOpen(true)} style={{ marginBottom: 10 }}>+ New post</button>)}
      {!rights?.post && <p className="hint">Notices here are posted by the office. Use Chat to talk.</p>}
      {posts === null && <p className="hint">Loading…</p>}
      {posts?.length === 0 && <p className="hint">No posts yet.</p>}
      {posts?.map((p) => (
        <div key={p.id} className="panel" style={{ borderLeft: p.pinned ? '4px solid var(--red, #c0392b)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ margin: 0, color: 'var(--charcoal)' }}>{p.pinned ? '📌 ' : ''}{p.title}</h3>
          </div>
          <div className="hint" style={{ fontSize: 12, margin: '2px 0 8px' }}>{p.authorName} · {when(p.createdAt)}</div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{p.body}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {p.ackedByMe
              ? <span className="hint">✓ You got it</span>
              : <button className="btn" onClick={() => act({ action: 'ack', id: p.id })}>Got it</button>}
            {rights?.moderate && <button className="btn-link" onClick={() => showSeen(p.id)}>{p.acks} got it — who?</button>}
            {rights?.moderate && <button className="btn-link" onClick={() => act({ action: 'pin', id: p.id, pinned: !p.pinned })}>{p.pinned ? 'Unpin' : 'Pin'}</button>}
            {(p.authorKey === me.key || rights?.moderate) && (
              <button className="btn-link" onClick={() => { if (confirm('Remove this post?')) act({ action: 'delete', id: p.id }); }}>Remove</button>
            )}
          </div>
          {seen[p.id] && <p className="hint" style={{ marginBottom: 0 }}>{seen[p.id].length ? seen[p.id].map((a) => a.name).join(', ') : 'Nobody yet.'}</p>}
        </div>
      ))}
    </div>
  );
}
