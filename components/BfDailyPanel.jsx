'use client';
import { useEffect, useState } from 'react';

// The daily Black Friday email: what today's says, a test send, and the on/off switch.
export default function BfDailyPanel() {
  const [cfg, setCfg] = useState(null);
  const [preview, setPreview] = useState(null);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch('/api/admin/bf-email').then((r) => r.json()).then((d) => { setCfg(d.config); setPreview(d.preview); }).catch(() => {}); }, []);

  async function post(body, done) {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/bf-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error || 'That did not work.'); return; }
      if (d.config) setCfg(d.config);
      setMsg(done);
    } catch { setMsg('Network error.'); } finally { setBusy(false); }
  }

  if (!cfg) return null;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Daily Black Friday email</h2>
      <p style={{ fontSize: 14, marginTop: 0 }}>
        <b>{cfg.enabled ? `ON: sends every day at 10am until ${cfg.until}` : 'OFF: nothing is sent'}</b>, to everyone who has agreed to get email. Plain text, built from that morning&apos;s stock.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Last day <input type="date" value={cfg.until} onChange={(e) => setCfg({ ...cfg, until: e.target.value })} /></label>
        <button className="btn accent" disabled={busy} onClick={() => {
          if (window.confirm(`Send this email to your whole list every day until ${cfg.until}?`)) post({ action: 'save', config: { enabled: true, until: cfg.until } }, 'Switched on.');
        }}>{cfg.enabled ? 'Save' : 'Switch on'}</button>
        {cfg.enabled && <button className="btn" disabled={busy} onClick={() => post({ action: 'save', config: { enabled: false, until: cfg.until } }, 'Switched off.')}>Switch off</button>}
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Test email address" aria-label="Test email address" />
        <button className="btn" disabled={busy || !to} onClick={() => post({ action: 'test', to }, 'Test sent.')}>Send test</button>
      </div>
      {msg && <p role="status" style={{ fontSize: 14 }}>{msg}</p>}
      {preview && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line, #eee)', paddingTop: 10 }}>
          <div style={{ fontSize: 14 }}><b>Subject:</b> {preview.subject}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14 }}>{preview.message}</pre>
        </div>
      )}
    </div>
  );
}
