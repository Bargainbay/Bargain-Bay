'use client';
import { useEffect, useState } from 'react';

const SEGMENTS = [
  { key: 'buyers', label: 'Past buyers (recommended)' },
  { key: 'members', label: 'Approved members' },
  { key: 'all', label: 'All accounts' }
];

export default function CampaignComposer({ emailConfigured, smsConfigured }) {
  const [channel, setChannel] = useState(emailConfigured ? 'email' : 'sms');
  const [segment, setSegment] = useState('buyers');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [testTo, setTestTo] = useState('');
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/campaigns?segment=${segment}`)
      .then((r) => r.json())
      .then((d) => { if (live) setCounts(d.counts); })
      .catch(() => {});
    return () => { live = false; };
  }, [segment]);

  const reach = counts ? (channel === 'email' ? counts.emailable : counts.smsable) : null;

  async function post(payload, kind) {
    setBusy(kind); setErr(''); setResult(null);
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Send failed.'); return; }
      setResult({ ...d.result, test: d.test });
    } catch {
      setErr('Network error.');
    } finally {
      setBusy('');
    }
  }

  function sendTest() {
    if (!testTo) { setErr(`Enter a test ${channel === 'email' ? 'email' : 'phone number'} first.`); return; }
    post({ channel, segment, subject, message, testTo }, 'test');
  }
  function sendCampaign() {
    if (!message.trim() || (channel === 'email' && !subject.trim())) { setErr('Add a subject and message first.'); return; }
    if (!reach) { setErr('No reachable recipients in this segment.'); return; }
    if (!window.confirm(`Send this ${channel.toUpperCase()} to ${reach} ${channel === 'email' ? 'email addresses' : 'phone numbers'}? This cannot be undone.`)) return;
    post({ channel, segment, subject, message }, 'send');
  }

  const channelOn = channel === 'email' ? emailConfigured : smsConfigured;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        {['email', 'sms'].map((c) => {
          const on = c === 'email' ? emailConfigured : smsConfigured;
          return (
            <button key={c} type="button" onClick={() => setChannel(c)}
              className={'btn' + (channel === c ? ' accent' : '')}
              title={on ? '' : 'Not configured'}>
              {c === 'email' ? 'Email' : 'SMS / Text'}{!on ? ' (not set up)' : ''}
            </button>
          );
        })}
      </div>

      {!channelOn && (
        <div className="error-box">
          {channel === 'email'
            ? 'Email isn\'t configured — set RESEND_API_KEY.'
            : 'SMS isn\'t configured — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM in Vercel.'}
        </div>
      )}

      <div className="field">
        <label>Audience</label>
        <select value={segment} onChange={(e) => setSegment(e.target.value)} style={{ maxWidth: 320 }}>
          {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div className="hint">
          {counts
            ? `${reach} reachable by ${channel === 'email' ? 'email' : 'text'} (of ${counts.total} in segment)`
            : 'Counting…'}
        </div>
      </div>

      {channel === 'email' && (
        <div className="field">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="New lot just landed — up to 70% off" />
        </div>
      )}

      <div className="field">
        <label>Message</label>
        <textarea rows={channel === 'sms' ? 4 : 7} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder={channel === 'sms' ? 'Hi {{name}}! Fresh appliances just dropped at Bargain Bay…' : 'Hi {{name}},\n\nWe just got a fresh lot in…'} />
        <div className="hint">
          Use <code>{'{{name}}'}</code> to insert the customer&apos;s first name.
          {channel === 'sms' ? ` ${message.length} chars (~${Math.max(1, Math.ceil((message.length + 20) / 160))} segment(s)). "Reply STOP to opt out" is added automatically.` : ' An unsubscribe line is added automatically.'}
        </div>
      </div>

      <div className="notice-box" style={{ fontSize: 13 }}>
        <b>Before you send (CASL):</b> only message people who&apos;ve bought from you or opted in. "Past buyers" is the safe default. Avoid blasting "All accounts" unless you have consent.
      </div>

      {err && <div className="error-box">{err}</div>}
      {result && (
        <div className="notice-box">
          {result.test ? '✓ Test sent' : '✓ Campaign sent'} — {result.sent} delivered{result.failed ? `, ${result.failed} failed` : ''}{result.skipped ? `, ${result.skipped} skipped (no ${channel === 'email' ? 'email' : 'phone'})` : ''}.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <input style={{ width: 220 }} value={testTo} onChange={(e) => setTestTo(e.target.value)}
          placeholder={channel === 'email' ? 'you@example.com' : '+16475551234'} />
        <button type="button" className="btn" disabled={!!busy || !channelOn} onClick={sendTest}>
          {busy === 'test' ? 'Sending…' : 'Send test'}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn accent" disabled={!!busy || !channelOn} onClick={sendCampaign}>
          {busy === 'send' ? 'Sending…' : `Send to ${reach ?? '…'} ${channel === 'email' ? 'emails' : 'numbers'}`}
        </button>
      </div>
    </div>
  );
}
