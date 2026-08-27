'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '../lib/constants';

// The conversion entry: what the business was worth on the day it started
// keeping books here. Entered once.
//
// Equity is NOT asked for — it's assets minus liabilities, computed and shown
// as you type. Asking an owner for "owner's equity" is asking the one question
// they can't answer, and any figure they guessed would just be absorbed into a
// balance sheet that then balanced to nothing real.
export default function OpeningBalances({ accounts, initial, canEdit = true }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState(initial?.asOf || '2026-09-01');
  const [vals, setVals] = useState(() => {
    const v = {};
    for (const a of accounts) v[a.code] = initial?.accounts?.[a.code] ? String(initial.accounts[a.code]) : '';
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const num = (c) => Number(vals[c]) || 0;
  const assets = accounts.filter((a) => a.type === 'asset').reduce((s, a) => s + num(a.code), 0);
  const liabilities = accounts.filter((a) => a.type === 'liability').reduce((s, a) => s + num(a.code), 0);
  const equity = Math.round((assets - liabilities) * 100) / 100;

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/ledger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'opening', asOf, accounts: vals })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save.');
      setMsg(`Books open at ${d.asOf}. Everything from that date on is now in the ledger.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13, width: 140, textAlign: 'right' };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        What the business was worth the day you started keeping books here. Enter it once — everything after this
        date is built from your own invoices, payments and expenses.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
        <label style={{ fontSize: 13 }}>Balances as at</label>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} disabled={!canEdit}
          style={{ ...inp, width: 'auto', textAlign: 'left' }} />
      </div>

      <div className="table-wrap">
        <table className="admin">
          <thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Opening balance</th><th>What to put here</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.code}>
                <td><b>{a.name}</b> <span style={{ color: 'var(--muted)', fontSize: 12 }}>{a.code}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" step="0.01" value={vals[a.code]} disabled={!canEdit}
                    onChange={(e) => setVals((v) => ({ ...v, [a.code]: e.target.value }))}
                    placeholder="0.00" style={inp} />
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>{a.help}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--line)' }}>
              <td><b>Owner&apos;s equity</b> <span style={{ color: 'var(--muted)', fontSize: 12 }}>3000</span></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(equity)}</td>
              <td style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                Worked out for you — assets less liabilities. If this looks wrong, a liability is missing above.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}

      {canEdit && (
        <div style={{ marginTop: 12 }}>
          <button className="btn accent" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : (initial?.set ? 'Update opening balances' : 'Open the books')}
          </button>
        </div>
      )}
    </div>
  );
}
