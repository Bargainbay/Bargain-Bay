'use client';
import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { safeNext } from '../lib/vendor-next';

// Setting up the authenticator. The QR is drawn HERE, in the browser, from the otpauth URL the
// server returned once — the secret is never put in a URL or an image request. Recovery codes
// are shown a single time, the moment they are made.
function Qr({ url }) {
  const box = useRef(null);
  useEffect(() => {
    if (!url || !box.current) return;
    const qr = qrcode(0, 'M');
    qr.addData(url); qr.make();
    box.current.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    const svg = box.current.querySelector('svg');
    if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
  }, [url]);
  return <div ref={box} style={{ width: 200, height: 200, background: '#fff' }} aria-label="QR code to scan with your authenticator app" role="img" />;
}

async function post(body) {
  const res = await fetch('/api/vendor/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || 'That did not work.');
  return j;
}

function RecoveryCodes({ codes, onDone }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 17 }}>Save your recovery codes</h2>
      <p style={{ fontSize: 14 }}>
        If you lose your phone, each of these signs you in once. <strong>This is the only time they are shown.</strong>{' '}
        Keep them somewhere safe (a password manager, or printed).
      </p>
      <pre style={{ fontSize: 16, lineHeight: 1.7, userSelect: 'all' }}>{codes.join('\n')}</pre>
      <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).catch(() => {})}>Copy</button>{' '}
      <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      <label style={{ display: 'block', margin: '12px 0', fontSize: 14 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes
      </label>
      <button type="button" className="btn" disabled={!saved} onClick={onDone}>Continue</button>
    </div>
  );
}

export default function VendorSecurity({ initial, next }) {
  const [state, setState] = useState(initial);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const begin = () => run(async () => { setSetup(await post({ action: 'begin' })); setCode(''); });
  const confirm = () => run(async () => {
    const j = await post({ action: 'confirm', code });
    setCodes(j.recoveryCodes); setSetup(null); setCode('');
    setState({ ...state, enrolled: true, verified: true, mustEnrol: false, recoveryLeft: j.recoveryCodes.length });
  });
  const regenerate = () => run(async () => {
    const j = await post({ action: 'recovery_codes', code });
    setCodes(j.recoveryCodes); setCode('');
    setState({ ...state, recoveryLeft: j.recoveryCodes.length });
  });

  if (codes) {
    return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); if (next) window.location.href = safeNext(next); }} />;
  }

  return (
    <div>
      <div className="panel">
        <h1 style={{ marginTop: 0, fontSize: 20 }}>Two-factor sign-in</h1>
        {!state.available && <p>Two-factor sign-in is not available yet. Please contact marketplace support.</p>}
        {state.available && state.enrolled && (
          <>
            <p style={{ fontSize: 14 }}><span className="pill ok">On</span> You have {state.recoveryLeft} recovery code(s) left.</p>
            <h3 style={{ fontSize: 15 }}>Get new recovery codes</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Enter a current code from your app. The old recovery codes stop working.</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" style={{ width: 140 }} />{' '}
            <button type="button" className="btn" disabled={busy || !code.trim()} onClick={regenerate}>Replace recovery codes</button>
            <p style={{ fontSize: 13 }}>Need to confirm it is you before a sensitive change? <a href={`/vendor/mfa?next=${encodeURIComponent(next || '/vendor')}&fresh=1`}>Enter a fresh code</a>.</p>
          </>
        )}
        {state.available && !state.enrolled && !setup && (
          <>
            <p style={{ fontSize: 14 }}>
              {state.required
                ? <>Your role needs two-factor sign-in{state.mustEnrol ? ' — the portal stays closed until it is set up.' : state.daysLeft > 0 ? ` within ${state.daysLeft} day(s).` : '.'}</>
                : 'Add a second step to signing in: a 6-digit code from an authenticator app on your phone.'}
            </p>
            <button type="button" className="btn" disabled={busy} onClick={begin}>Set up two-factor sign-in</button>
          </>
        )}
        {setup && (
          <>
            <ol style={{ fontSize: 14, paddingLeft: 18 }}>
              <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
              <li>Scan this code, or type the key by hand.</li>
              <li>Enter the 6-digit code it shows to finish.</li>
            </ol>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <Qr url={setup.otpauthUrl} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Key (shown once)</div>
                <code style={{ fontSize: 16, userSelect: 'all' }}>{setup.display}</code>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" style={{ width: 140 }} />{' '}
              <button type="button" className="btn" disabled={busy || !code.trim()} onClick={confirm}>Confirm and turn on</button>
            </div>
          </>
        )}
        {err && <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 14 }}>{err}</p>}
      </div>
    </div>
  );
}
