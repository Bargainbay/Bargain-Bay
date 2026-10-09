'use client';
import { useState } from 'react';

// Banking details. The full number is never sent back to this page — only the last four digits.
export default function VendorBank({ initial, isOwner, configured }) {
  const [sum, setSum] = useState(initial);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ holderName: '', institution: '', transit: '', account: '', method: 'direct_deposit' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setNote('');
    try {
      const res = await fetch('/api/vendor/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save those details.'); return; }
      setNote(`Submitted (account ending ${d.last4}). We will verify it before it is used for a payout.`);
      setOpen(false);
      setF({ holderName: '', institution: '', transit: '', account: '', method: 'direct_deposit' });
      setSum(await (await fetch('/api/vendor/bank')).json());
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  const line = (a) => `${a.holderName} · institution ${a.institution} · transit ${a.transit} · account ••••${a.last4}`;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 17 }}>Banking details</h2>
      {err && <div className="error-box">{err}</div>}
      {note && <p style={{ color: 'var(--ok)' }}>{note}</p>}
      {sum.payable ? <p style={{ fontSize: 14 }}><span className="pill ok">Paying to</span> {line(sum.payable)}</p>
        : <p style={{ fontSize: 14 }}><span className="pill warn">No verified account</span> We cannot pay you until one is verified.</p>}
      {sum.waiting.map((w) => (
        <p key={w.id} style={{ fontSize: 14 }}>
          <span className="pill">{w.status === 'pending' ? 'Awaiting verification' : 'Verified — safety wait'}</span> {line(w)}
          {w.coolingUntil && <> · used from {new Date(w.coolingUntil).toISOString().slice(0, 10)}; until then payouts go to your previous account</>}
        </p>
      ))}
      {!configured && <div className="error-box">Banking details cannot be stored yet — contact us. (The server is missing its encryption key.)</div>}
      {isOwner ? (
        <>
          {!open && <button className="btn" onClick={() => setOpen(true)} disabled={!configured}>{sum.payable ? 'Change account' : 'Add account'}</button>}
          {open && (
            <form onSubmit={submit} style={{ maxWidth: 460 }}>
              <div className="field"><label>Account holder (as on the account — must match your business)</label><input value={f.holderName} onChange={set('holderName')} required /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
                <div className="field"><label>Institution (3)</label><input value={f.institution} onChange={set('institution')} inputMode="numeric" required /></div>
                <div className="field"><label>Transit (5)</label><input value={f.transit} onChange={set('transit')} inputMode="numeric" required /></div>
                <div className="field"><label>Account number</label><input value={f.account} onChange={set('account')} inputMode="numeric" autoComplete="off" required /></div>
              </div>
              <div className="field"><label>Pay me by</label>
                <select value={f.method} onChange={set('method')}><option value="direct_deposit">Direct deposit</option><option value="wire">Wire</option></select></div>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                We verify every account (a void cheque or bank letter) before using it. If you are replacing an account, payouts keep going
                to the old one for 5 days after we verify the new one — a safety measure against someone taking over a login.
                Everyone on your account is emailed whenever banking details change.
              </p>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Submit for verification'}</button>{' '}
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            </form>
          )}
        </>
      ) : <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>Only the account owner can change banking details.</p>}
    </div>
  );
}
