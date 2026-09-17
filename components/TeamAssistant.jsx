'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// The crew's AI manager, as a button in the corner of the driver app and the
// staff portal. Tap the mic and talk (any language), or type. Replies are read
// aloud. "Conversation" keeps listening after each answer, so somebody with
// both hands on a dolly can carry on without touching the phone again — for as
// long as this page is on screen. A web page cannot listen while the phone is
// locked or another app is in front; that is what the native app is for.
//
// It renders nothing for anyone the endpoint turns away (a customer account, a
// coordinator), so it can sit in shared chrome without a role check of its own.

const THREAD_KEY = 'bb_assistant_thread';
const SPEAK_KEY = 'bb_assistant_speak';
const MAX_RECORD_MS = 60000;
// Conversation mode: stop recording after this much quiet once they've spoken.
const SILENCE_MS = 1300;
const SILENCE_LEVEL = 0.018;
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

function pickMime() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (window.MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export default function TeamAssistant({ placement = 'staff' }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState([]);
  const [text, setText] = useState('');
  const [state, setState] = useState('idle'); // idle | listening | thinking | speaking
  const [error, setError] = useState('');
  const [speak, setSpeak] = useState(true);
  const [talkMode, setTalkMode] = useState(false);

  const recRef = useRef(null);
  const streamRef = useRef(null);
  // Replies play through Web Audio. The context is created and resumed INSIDE
  // the tap that starts listening, which is what lets iOS play a reply that only
  // arrives after a network round trip; an <audio> element started later is
  // refused as autoplay.
  const playerRef = useRef(null);
  const sourceRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimer = useRef(null);
  const meterRef = useRef(null);
  const talkRef = useRef(false);
  const listRef = useRef(null);
  talkRef.current = talkMode;

  // Who am I, and is there a conversation to pick back up.
  useEffect(() => {
    const saved = safe(() => window.localStorage.getItem(THREAD_KEY));
    setSpeak(safe(() => window.localStorage.getItem(SPEAK_KEY)) !== '0');
    fetch(`/api/assistant${saved ? `?threadId=${encodeURIComponent(saved)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.ok) return;
        setAllowed(true);
        setVoice(!!d.voice);
        setThreadId(d.threadId);
        setMessages(d.messages || []);
        setPending(d.pending || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, state]);

  const releaseMic = useCallback(() => {
    if (meterRef.current) { meterRef.current.stop(); meterRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
  }, []);

  const stopSpeaking = useCallback(() => {
    const src = sourceRef.current;
    sourceRef.current = null;
    if (src) { src.onended = null; try { src.stop(); } catch { /* already stopped */ } }
  }, []);

  const unlockAudio = useCallback(() => {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return;
    if (!playerRef.current) playerRef.current = new Ctx();
    playerRef.current.resume?.().catch(() => {});
  }, []);

  const playReply = useCallback(async (base64, onDone) => {
    const ctx = playerRef.current;
    if (!ctx) { onDone(); return; }
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      stopSpeaking();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => { if (sourceRef.current === src) { sourceRef.current = null; onDone(); } };
      sourceRef.current = src;
      src.start();
    } catch {
      onDone();
    }
  }, [stopSpeaking]);

  useEffect(() => () => { releaseMic(); stopSpeaking(); playerRef.current?.close?.().catch(() => {}); }, [releaseMic, stopSpeaking]);

  const send = useCallback(async ({ typed, blob }) => {
    setError('');
    setState('thinking');
    if (typed) setMessages((m) => [...m, { role: 'user', content: typed }]);
    try {
      let res;
      if (blob) {
        const form = new FormData();
        form.append('audio', blob, 'speech');
        if (threadId) form.append('threadId', String(threadId));
        form.append('speak', speak ? '1' : '0');
        res = await fetch('/api/assistant', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: typed, threadId, speak })
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That didn’t go through.');
      if (data.threadId) {
        setThreadId(data.threadId);
        safe(() => window.localStorage.setItem(THREAD_KEY, String(data.threadId)));
      }
      setMessages((m) => [
        ...m,
        ...(data.heard ? [{ role: 'user', content: data.heard, lang: data.lang }] : []),
        { role: 'assistant', content: data.reply }
      ]);
      setPending(data.pending || []);
      if (data.audio?.base64 && playerRef.current) {
        setState('speaking');
        await playReply(data.audio.base64, () => {
          setState('idle');
          // Conversation mode: their turn again.
          if (talkRef.current) startListeningRef.current?.();
        });
      } else {
        setState('idle');
      }
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setState('idle');
      if (blob && talkRef.current) setTalkMode(false);
    }
  }, [threadId, speak, playReply]);

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state === 'recording') rec.stop();
  }, []);

  const startListening = useCallback(async () => {
    setError('');
    unlockAudio();
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t record — type instead.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError('Microphone permission is off for this site. Turn it on in the browser settings to talk.');
      setTalkMode(false);
      return;
    }
    streamRef.current = stream;
    const rec = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const heardSomething = meterRef.current ? meterRef.current.spoke : true;
      releaseMic();
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' });
      if (!heardSomething || blob.size < 1500) {
        setState('idle');
        if (talkRef.current) setTalkMode(false);
        return;
      }
      send({ blob });
    };
    rec.start();
    setState('listening');
    stopTimer.current = setTimeout(stopListening, MAX_RECORD_MS);

    // Stop by itself after they finish talking (conversation mode), and in
    // any mode give up if nobody speaks at all.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const meter = { spoke: false, quietSince: Date.now(), startedAt: Date.now(), raf: 0 };
      meter.stop = () => { cancelAnimationFrame(meter.raf); ctx.close().catch(() => {}); };
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const level = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (level > SILENCE_LEVEL) { meter.spoke = true; meter.quietSince = now; }
        const quiet = now - meter.quietSince;
        if ((talkRef.current && meter.spoke && quiet > SILENCE_MS) || (!meter.spoke && now - meter.startedAt > 8000)) {
          stopListening();
          return;
        }
        meter.raf = requestAnimationFrame(tick);
      };
      meter.raf = requestAnimationFrame(tick);
      meterRef.current = meter;
    } catch {
      // No Web Audio: tap to stop still works.
    }
  }, [releaseMic, send, stopListening, unlockAudio]);
  const startListeningRef = useRef(null);
  startListeningRef.current = startListening;

  const micTap = () => {
    if (state === 'listening') { stopListening(); return; }
    if (state === 'speaking') { stopSpeaking(); setState('idle'); return; }
    if (state === 'idle') startListening();
  };

  const toggleTalk = () => {
    const next = !talkMode;
    setTalkMode(next);
    if (next && state === 'idle') startListening();
    if (!next && state === 'listening') stopListening();
  };

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || state === 'thinking') return;
    unlockAudio();
    setText('');
    send({ typed: t });
  };

  const answer = (yes) => { unlockAudio(); send({ typed: yes ? 'Yes, go ahead.' : 'No, cancel that.' }); };

  const newChat = () => {
    safe(() => window.localStorage.removeItem(THREAD_KEY));
    setThreadId(null);
    setMessages([]);
    setPending([]);
  };

  if (!allowed) return null;

  const status = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking — tap to stop' }[state] || '';

  return (
    <div className={`asst asst-${placement}`}>
      {!open && (
        <button type="button" className="asst-fab" onClick={() => setOpen(true)} aria-label="Open the RS Manager assistant">
          <span aria-hidden="true">🎙</span>
        </button>
      )}
      {open && (
        <section className="asst-panel" aria-label="RS Manager assistant">
          <header className="asst-head">
            <b>RS Manager</b>
            <span className="asst-status" aria-live="polite">{status}</span>
            <button type="button" className="asst-x" onClick={newChat} title="Start a new conversation">New</button>
            <button type="button" className="asst-x" onClick={() => { setOpen(false); setTalkMode(false); stopListening(); }} aria-label="Close">✕</button>
          </header>

          <div className="asst-list" ref={listRef}>
            {!messages.length && (
              <p className="asst-hint">
                Ask about your stops, where a unit is, a part, an order — or say “walk me through” a delivery or a repair.
                Talk in English, தமிழ், ਪੰਜਾਬੀ, हिन्दी, اردو or Español.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`asst-msg asst-${m.role}`} dir="auto">{m.content}</div>
            ))}
            {pending.length > 0 && state === 'idle' && (
              <div className="asst-confirm">
                <button type="button" className="btn" onClick={() => answer(true)}>Yes, do it</button>
                <button type="button" className="btn btn-secondary" onClick={() => answer(false)}>No</button>
              </div>
            )}
            {error && <div className="asst-error" role="alert">{error}</div>}
          </div>

          <form className="asst-input" onSubmit={submit}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a question…"
              dir="auto"
              aria-label="Message"
            />
            {voice && (
              <button
                type="button"
                className={`asst-mic ${state === 'listening' ? 'on' : ''}`}
                onClick={micTap}
                disabled={state === 'thinking'}
                aria-label={state === 'listening' ? 'Stop and send' : 'Talk'}
              >
                {state === 'listening' ? '■' : '🎙'}
              </button>
            )}
            {!voice && <button type="submit" className="btn" disabled={state === 'thinking'}>Send</button>}
          </form>

          {voice && (
            <div className="asst-opts">
              <label>
                <input type="checkbox" checked={talkMode} onChange={toggleTalk} /> Conversation (keeps listening)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={speak}
                  onChange={(e) => { setSpeak(e.target.checked); safe(() => window.localStorage.setItem(SPEAK_KEY, e.target.checked ? '1' : '0')); }}
                /> Read replies aloud
              </label>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
