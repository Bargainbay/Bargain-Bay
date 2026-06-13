'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'bb_chat_v1';
const GREETING = {
  role: 'assistant',
  content:
    "Hi! I'm Bay, your Bargain Bay assistant. I can help you find a tested, warrantied appliance at liquidation prices. What are you shopping for?"
};
const QUICK_PROMPTS = [
  'Show me fridges under $1000',
  'What washers do you have?',
  'How does the warranty work?',
  'Do you deliver to Scarborough?'
];

// Turn assistant text into React nodes: markdown links, bare URLs, internal
// /paths and emails become clickable; newlines become line breaks.
function parseLine(line, keyBase) {
  const nodes = [];
  const re =
    /\[([^\]]+)\]\(([^)]+)\)|((?:https?:\/\/|mailto:)[^\s)]+)|(\/(?:product|shop|policies|track|contact|cart)[A-Za-z0-9/_\-?=&.]*)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push(line.slice(last, m.index));
    if (m[1] && m[2]) {
      const ext = m[2].startsWith('http');
      nodes.push(
        <a key={`${keyBase}-${i++}`} href={m[2]} target={ext ? '_blank' : undefined} rel="noopener noreferrer">
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      nodes.push(
        <a key={`${keyBase}-${i++}`} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>
      );
    } else if (m[4]) {
      nodes.push(
        <a key={`${keyBase}-${i++}`} href={m[4]}>
          {m[4]}
        </a>
      );
    } else if (m[5]) {
      nodes.push(
        <a key={`${keyBase}-${i++}`} href={`mailto:${m[5]}`}>
          {m[5]}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

function Rich({ text }) {
  const lines = String(text).split('\n');
  return lines.map((line, li) => (
    <span key={li}>
      {parseLine(line, li)}
      {li < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Restore prior conversation.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved) && saved.length) setMessages(saved);
    } catch {}
  }, []);

  // Persist + autoscroll.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {}
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  async function send(textArg) {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next })
      });
      const data = await res.json().catch(() => ({}));
      const reply =
        data.reply || "Sorry, I'm having trouble right now. Please email sales@bargainbay.ca and we'll help right away.";
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: "Sorry, I couldn't reach the network. Please try again, or email sales@bargainbay.ca." }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const showQuick = messages.length <= 1 && !loading;

  return (
    <>
      <button
        type="button"
        className="bb-chat-fab"
        aria-label={open ? 'Close chat' : 'Chat with Bay'}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="bb-chat-panel" role="dialog" aria-label="Bargain Bay chat">
          <div className="bb-chat-head">
            <div className="bb-chat-ava">B</div>
            <div className="bb-chat-head-txt">
              <strong>Bay</strong>
              <span>Bargain Bay assistant</span>
            </div>
            <button type="button" className="bb-chat-x" aria-label="Close" onClick={() => setOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="bb-chat-body" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bb-msg ${m.role === 'user' ? 'me' : 'bot'}`}>
                <div className="bb-bubble">
                  <Rich text={m.content} />
                </div>
              </div>
            ))}
            {loading && (
              <div className="bb-msg bot">
                <div className="bb-bubble bb-typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
            {showQuick && (
              <div className="bb-quick">
                {QUICK_PROMPTS.map((q) => (
                  <button type="button" key={q} className="bb-chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bb-chat-input">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask about an appliance…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" className="bb-send" aria-label="Send" disabled={loading || !input.trim()} onClick={() => send()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
          <div className="bb-chat-foot">Bay can make mistakes — confirm details before you buy.</div>
        </div>
      )}
    </>
  );
}
