'use client';
import { useState, useRef, useEffect } from 'react';

// Friendly labels for the action chips shown under an assistant reply.
const ACTION_LABEL = {
  search_inventory: 'Searched inventory',
  inventory_summary: 'Read stock summary',
  list_invoices: 'Listed invoices',
  create_invoice: 'Created invoice',
  mark_invoice_paid: 'Marked invoice paid',
  void_invoice: 'Voided invoice',
  reprice_unit: 'Repriced unit',
  mark_unit_sold: 'Marked unit sold',
  relist_unit: 'Relisted unit',
  sync_inventory: 'Synced inventory',
  remember: 'Saved to playbook',
  check_email: 'Checked email',
  read_email: 'Read email',
  send_email: 'Sent email',
  delegate: 'Asked the team'
};

const SUGGESTIONS = [
  'How much stock do we have right now?',
  'Show me the last few invoices',
  'Find our Whirlpool fridges',
  'Invoice jane@example.com for the KitchenAid dishwasher'
];

export default function OpsCopilot() {
  const [agents, setAgents] = useState([]);     // [{ key, name, title, blurb }]
  const [agentKey, setAgentKey] = useState('sarah');
  const [messages, setMessages] = useState([]); // { role, content, actions? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scroller = useRef(null);

  useEffect(() => {
    fetch('/api/admin/agents').then((r) => r.json()).then((d) => {
      if (Array.isArray(d.agents)) setAgents(d.agents);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);

  const active = agents.find((a) => a.key === agentKey);

  // Switching who you're talking to starts a fresh conversation (each agent keeps
  // its own lane — mixing transcripts would confuse the context).
  function switchAgent(key) {
    if (key === agentKey) return;
    setAgentKey(key);
    setMessages([]);
    setErr('');
  }

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setErr('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey, messages: next.map((m) => ({ role: m.role, content: m.content })) })
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error || 'The copilot couldn’t respond. Try again.');
      } else {
        setMessages((cur) => [...cur, { role: 'assistant', content: d.reply, actions: d.actions || [] }]);
      }
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'min(70vh, 640px)' }}>
      {agents.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Talk to:</span>
          {agents.map((a) => (
            <button
              key={a.key}
              type="button"
              className={'btn' + (a.key === agentKey ? ' accent' : '')}
              style={{ fontSize: 12.5, padding: '5px 10px' }}
              title={a.blurb || a.title}
              onClick={() => switchAgent(a.key)}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, padding: '8px 2px' }}>
            <p style={{ margin: '0 0 10px' }}>
              {active && active.key !== 'sarah' ? (
                <>You’re talking to <b>{active.name}</b> — {active.blurb || active.title}. {active.title === active.name ? '' : ''}They’ll confirm before any action that changes live data or emails a customer.</>
              ) : (
                <>Hi — I’m <b>Sarah</b>, your Chief of Staff. Ask me anything across operations and I’ll handle it or hand it to
                the right specialist on the team. I’ll always confirm before I email a customer or change live data.</>
              )}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn" style={{ fontSize: 12.5, padding: '6px 11px' }} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div style={{
              background: m.role === 'user' ? 'var(--charcoal)' : 'var(--surface, #f6f5f1)',
              color: m.role === 'user' ? '#fff' : 'var(--ink)',
              border: m.role === 'user' ? 'none' : '1px solid var(--line)',
              borderRadius: 12, padding: '9px 13px', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap'
            }}>
              {m.content}
            </div>
            {m.role === 'assistant' && m.actions && m.actions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {m.actions.map((a, j) => (
                  <span key={j} className={'pill ' + (a.ok ? 'ok' : 'sold')} style={{ fontSize: 11.5 }}>
                    {a.ok ? '✓' : '⚠'} {ACTION_LABEL[a.name] || a.name}
                    {a.name === 'delegate' && a.dept ? ` → ${a.dept.replace(/_/g, ' ')}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13.5, padding: '4px 2px' }}>
            Working…
          </div>
        )}
      </div>

      {err && <div className="error-box" style={{ margin: '8px 0 0' }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="e.g. Invoice john@example.com for SKU June8Refurb-092, pickup"
          rows={2}
          style={{ flex: 1, resize: 'none', fontSize: 14 }}
        />
        <button className="btn accent" disabled={busy || !input.trim()} onClick={() => send()} style={{ height: 42 }}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        The copilot confirms before emailing a customer or changing inventory. Press Enter to send, Shift+Enter for a new line.
      </div>
    </div>
  );
}
