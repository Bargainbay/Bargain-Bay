'use client';
// The rep reads both agreements to the end, types their full legal name and home address, ticks the box and
// signs, all inside the Sales Hub. Afterwards the signed copy can be printed / saved as a PDF, downloaded or
// emailed. The server re-checks everything (lib/rep-agreements.js); this screen only makes it easy.
import { useState } from 'react';
import AgreementScroll from './AgreementScroll';

const when = (t) => new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });

export default function RepAgreement({ state, isRep }) {
  const [s, setS] = useState(state);
  const [readA, setReadA] = useState(false);
  const [readB, setReadB] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const ready = isRep && s.canSign && readA && readB && agreed && name.trim().length >= 3 && /\s/.test(name.trim()) && address.trim().length >= 8;

  async function sign() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/sales/agreement', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sign', typedName: name, address, agreed, hash: s.hash }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      // Reload so the page is rebuilt from the stored record, not from what is in this form.
      window.location.reload();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  async function email() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/sales/agreement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'email' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      setMsg(j.ok ? 'A copy is on its way to your email.' : 'The email could not be sent right now. Use Print / Save as PDF or Download instead.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (s.signed) {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>✓ You signed your agreements</h2>
        <p style={{ fontSize: 14 }}>
          Signed as <b>{s.signed.name}</b> on {when(s.signed.at)} (Toronto time). {s.signed.countersigned
            ? <>Countersigned for the company by {s.signed.countersigned.name} on {when(s.signed.countersigned.at)}.</>
            : <>The company&apos;s countersignature is still to come; your copy will say so until it is added.</>}
        </p>
        <p className="hint">Keep your own copy: it is the exact text you signed.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn accent" href="/sales/agreement/copy">View / Print / Save as PDF</a>
          <a className="btn" href="/api/sales/agreement?download=1">Download a copy</a>
          {isRep && <button className="btn" onClick={email} disabled={busy}>Email me a copy</button>}
        </div>
        {msg && <p role="status" className="hint">{msg}</p>}
        {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
      </div>
    );
  }

  return (
    <div>
      {!s.open && (
        <div className="panel" style={{ background: '#fff8e1' }}>
          <b>Signing is not open yet.</b> You can read both agreements below now. The owner will open signing when they are ready, and you will be able to sign right here.
        </div>
      )}
      {s.open && s.unresolved.length > 0 && (
        <div className="panel" style={{ background: '#fff8e1' }}>
          <b>Not ready to sign:</b> the company still has to fill in {s.unresolved.length} detail{s.unresolved.length > 1 ? 's' : ''} (shown in [brackets] below). Nothing to do on your side.
        </div>
      )}
      {!isRep && <div className="panel hint">You are viewing this as an admin. Only the sales rep signs.</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>1. Offer of Employment and Employment Agreement</h2>
        <AgreementScroll sections={s.employment} label="Employment Agreement" read={readA} onRead={() => setReadA(true)} maxHeight={420} />
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>2. Confidentiality and Non-Solicitation Agreement</h2>
        <p className="hint" style={{ marginTop: 0 }}>This forms part of the Employment Agreement (section 10).</p>
        <AgreementScroll sections={s.confidentiality} label="Confidentiality and Non-Solicitation Agreement" read={readB} onRead={() => setReadB(true)} maxHeight={320} />
      </div>

      {isRep && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Sign</h2>
          <label style={{ display: 'block', marginBottom: 10 }}>Your full legal name (this is your signature)
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={!s.canSign} />
          </label>
          <label style={{ display: 'block', marginBottom: 10 }}>Your home address
            <input value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" disabled={!s.canSign} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 4 }} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={!s.canSign} />
            <span>I have read both agreements in full and I agree to them. I understand that typing my name is my signature, and that the date and time I sign are recorded. I have had the chance to get independent legal advice.</span>
          </label>
          <button className="btn accent" onClick={sign} disabled={!ready || busy}>{busy ? 'Signing…' : 'Sign both agreements'}</button>
          {!ready && s.canSign && <p className="hint">To sign: scroll to the end of both agreements, fill in your name and address, and tick the box.</p>}
          {err && <p role="alert" style={{ color: 'var(--red, #c33)' }}>{err}</p>}
        </div>
      )}
    </div>
  );
}
