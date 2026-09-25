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
  const [consent, setConsent] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let live = true;
    setConsent(null);
    fetch(`/api/admin/campaigns?segment=${segment}&channel=${channel}`)
      .then((r) => r.json())
      .then((d) => { if (live) { setCounts(d.counts); setConsent(d.consent || null); } })
      .catch(() => {});
    return () => { live = false; };
  }, [segment, channel]);

  // REACH IS WHAT CONSENT ALLOWS, not what the segment contains. Those are
  // different numbers, and before this the composer only ever showed the
  // second one — so a campaign to "412 past buyers" went to 412 people
  // regardless of who had asked us to stop.
  const contactable = counts ? (channel === 'email' ? counts.emailable : counts.smsable) : null;
  const reach = consent && !consent.failed ? consent.allowed : null;

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
    if (consent && consent.failed) { setErr('The consent list could not be read, so nothing can be sent. Try again.'); return; }
    if (!reach) { setErr('Nobody in this segment has consented to be messaged on this channel.'); return; }
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
            ? `${reach ?? '…'} may be ${channel === 'email' ? 'emailed' : 'texted'} · ${contactable} contactable · ${counts.total} in segment`
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

      {/* This used to be advice. It is now a description of what the send
          actually does — the filter is in lib/consent and this is only
          reporting it, so the number on the button is the number that goes. */}
      {consent && consent.failed && (
        <div className="error-box" style={{ fontSize: 13 }}>
          <b>The consent list could not be read.</b> Nothing can be sent until it can —
          this is the one gate here that fails closed, because sending without
          checking is the thing it exists to prevent.
        </div>
      )}
      {consent && !consent.failed && (
        <div className="notice-box" style={{ fontSize: 13 }}>
          <b>Who this goes to.</b> Only people with consent on record: they ticked the
          box, or they bought from us in the last 24 months, or they asked for a quote
          in the last 6 (Canada&apos;s anti-spam law, CASL).
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li><b>{consent.allowed}</b> will be {channel === 'email' ? 'emailed' : 'texted'}</li>
            {consent.withdrawn > 0 && (
              <li><b>{consent.withdrawn}</b> opted out — excluded, permanently</li>
            )}
            {consent.noConsent > 0 && (
              <li><b>{consent.noConsent}</b> have no consent on record — excluded</li>
            )}
            {consent.noValue > 0 && (
              <li><b>{consent.noValue}</b> have no {channel === 'email' ? 'email address' : 'phone number'}</li>
            )}
          </ul>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}
      {result && (
        <div className="notice-box">
          {result.test ? '✓ Test sent' : '✓ Campaign sent'} — {result.sent} delivered{result.failed ? `, ${result.failed} failed` : ''}{result.skipped ? `, ${result.skipped} skipped (no ${channel === 'email' ? 'email' : 'phone'})` : ''}.
          {result.blocked && (result.blocked.withdrawn > 0 || result.blocked.noConsent > 0) && (
            <div style={{ marginTop: 4, fontSize: 12.5 }}>
              Held back: {result.blocked.withdrawn} opted out, {result.blocked.noConsent} with no consent on record.
            </div>
          )}
          {result.consentError && <div style={{ marginTop: 4, color: '#b3261e' }}>{result.consentError}</div>}
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
