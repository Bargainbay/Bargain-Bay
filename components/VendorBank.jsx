'use client';
import { useState } from 'react';

// Banking details. The full number is never sent back to this page — only the last four digits.
export default function VendorBank({ initial, isOwner, configured }) {
  const [sum, setSum] = useState(initial);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ holderName: '', institution: '', transit: '', account: '', etransferEmail: '', method: 'direct_deposit' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mfa, setMfa] = useState('');
  const [note, setNote] = useState('');
  const isEt = f.method === 'etransfer';
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setNote(''); setMfa('');
    try {
      const res = await fetch('/api/vendor/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save those details.'); setMfa(d.mfa || ''); return; }
      setNote(`Submitted (${d.label}). We will verify it before it is used for a payout.`);
      setOpen(false);
      setF({ holderName: '', institution: '', transit: '', account: '', etransferEmail: '', method: 'direct_deposit' });
      setSum(await (await fetch('/api/vendor/bank')).json());
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  const line = (a) => a.method === 'etransfer' ? `${a.holderName} · Interac e-transfer to ${a.email}` : `${a.holderName} · institution ${a.institution} · transit ${a.transit} · account ••••${a.last4}`;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 17 }}>How you get paid</h2>
      {err && (
        <div className="error-box">
          {err}{' '}
          {mfa === 'stepup' && <a href="/vendor/mfa?next=/vendor/payouts&fresh=1">Enter a fresh code →</a>}
          {mfa === 'two_step' && <a href="/vendor/security?next=/vendor/payouts">Confirm your 2-step verification →</a>}
          {mfa === 'enrol' && <a href="/vendor/security?next=/vendor/payouts">Set up two-factor sign-in →</a>}
          {mfa === 'verify' && <a href="/vendor/mfa?next=/vendor/payouts">Enter your code →</a>}
        </div>
      )}
      {note && <p style={{ color: 'var(--ok)' }}>{note}</p>}
      {sum.payable ? <p style={{ fontSize: 14 }}><span className="pill ok">Paying to</span> {line(sum.payable)}</p>
        : <p style={{ fontSize: 14 }}><span className="pill warn">No verified payout method</span> We cannot pay you until one is verified.</p>}
      {sum.waiting.map((w) => (
        <p key={w.id} style={{ fontSize: 14 }}>
          <span className="pill">{w.status === 'pending' ? 'Awaiting verification' : 'Verified — safety wait'}</span> {line(w)}
          {w.coolingUntil && <> · used from {new Date(w.coolingUntil).toISOString().slice(0, 10)}; until then payouts go to your previous account</>}
        </p>
      ))}
      {!configured && <div className="error-box">Bank account details cannot be stored yet — contact us. (The server is missing its encryption key.) You can still choose Interac e-transfer.</div>}
      {isOwner ? (
        <>
          {!open && <button className="btn" onClick={() => setOpen(true)}>{sum.payable ? 'Change how I get paid' : 'Choose how I get paid'}</button>}
          {open && (
            <form onSubmit={submit} style={{ maxWidth: 460 }}>
              <div className="field"><label>Pay me by</label>
                <select value={f.method} onChange={set('method')}>
                  <option value="direct_deposit">Direct deposit to my bank account</option>
                  <option value="wire">Wire to my bank account</option>
                  <option value="etransfer">Interac e-transfer</option>
                </select></div>
              <div className="field"><label>{isEt ? 'Name on the receiving bank account (must match your business)' : 'Account holder (as on the account — must match your business)'}</label><input value={f.holderName} onChange={set('holderName')} required /></div>
              {isEt ? (
                <div className="field"><label>Email address that receives the e-transfer</label><input type="email" value={f.etransferEmail} onChange={set('etransferEmail')} autoComplete="off" required />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Turn on Autodeposit for this address with your bank, or the transfer cannot arrive.</span></div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
                  <div className="field"><label>Institution (3)</label><input value={f.institution} onChange={set('institution')} inputMode="numeric" required /></div>
                  <div className="field"><label>Transit (5)</label><input value={f.transit} onChange={set('transit')} inputMode="numeric" required /></div>
                  <div className="field"><label>Account number</label><input value={f.account} onChange={set('account')} inputMode="numeric" autoComplete="off" required /></div>
                </div>
              )}
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                We verify every payout method before using it (a void cheque or bank letter for a bank account, a small test e-transfer for an e-transfer address). If you are replacing one, payouts keep going
                to the old one for 5 days after we verify the new one — a safety measure against someone taking over a login.
                Everyone on your account is emailed whenever payout details change.
              </p>
              <button className="btn primary" disabled={busy || (!isEt && !configured)}>{busy ? 'Saving…' : 'Submit for verification'}</button>{' '}
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            </form>
          )}
        </>
      ) : <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>Only the account owner can change banking details.</p>}
    </div>
  );
}
