'use client';
import { useState } from 'react';

// How a driver gets in, every day after the first.
//
// The texted link is one message. It gets deleted, it gets tapped on the wrong
// phone, it lands on a device that later gets wiped — and then the driver is
// standing at a van waiting for the office to open. Typing your own mobile and
// six digits needs nobody.
//
// Two big fields, numeric keypads, and nothing else on the screen.
export default function DriverSignIn() {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function post(payload) {
    const res = await fetch('/api/driver/signin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function sendCode(e) {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const { ok, data } = await post({ phone });
      if (!ok) { setErr(data.error || 'Could not send a code.'); return; }
      setStep('code');
    } catch {
      setErr('No signal — try again in a moment.');
    } finally { setBusy(false); }
  }

  async function signIn(e) {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const { ok, data } = await post({ step: 'verify', phone, code });
      if (!ok) { setErr(data.error || 'That code did not work.'); return; }
      // Full reload rather than a router push: the session cookie was just set,
      // and the stop list is rendered on the server from it.
      window.location.href = '/driver?welcome=1';
    } catch {
      setErr('No signal — try again in a moment.');
    } finally { setBusy(false); }
  }

  return (
    <div className="drv-card">
      <h1 className="drv-hello" style={{ marginTop: 0 }}>Your stops</h1>

      {step === 'phone' ? (
        <form onSubmit={sendCode}>
          <p className="hint" style={{ marginTop: 0 }}>
            Put in your mobile number and we&apos;ll text you a code.
          </p>
          <div className="drv-field">
            <label htmlFor="drv-phone">Mobile number</label>
            <input id="drv-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
              inputMode="tel" autoComplete="tel" placeholder="647 555 0134" />
          </div>
          {err && <div className="error-box">{err}</div>}
          <button className="drv-btn done" disabled={busy || phone.replace(/\D+/g, '').length < 10}>
            {busy ? 'Sending…' : 'Text me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={signIn}>
          <p className="hint" style={{ marginTop: 0 }}>
            We texted six digits to {phone}. It lasts 15 minutes.
          </p>
          <div className="drv-field">
            <label htmlFor="drv-code">Code</label>
            <input id="drv-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D+/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
              style={{ fontSize: 28, letterSpacing: '.3em', textAlign: 'center' }} />
          </div>
          {err && <div className="error-box">{err}</div>}
          <button className="drv-btn done" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <div className="drv-row" style={{ marginTop: 10 }}>
            <button type="button" className="drv-btn small" disabled={busy} onClick={sendCode}>Send it again</button>
            <button type="button" className="drv-btn small" disabled={busy}
              onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>Wrong number</button>
          </div>
        </form>
      )}

      <p className="hint" style={{ marginTop: 14 }}>
        Signed in on this phone for six months. If the office texted you a link, that still works too.
      </p>
    </div>
  );
}
