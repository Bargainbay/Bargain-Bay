'use client';
// Incoming e-transfers from the bank, beside the orders and invoices they most likely pay.
// Nothing is confirmed automatically: the highlighted button is a suggestion, and pressing it is the act.
import { useEffect, useState } from 'react';

const money = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { sure: 'ok', likely: 'warn', maybe: '' };
const WORD = { sure: 'Looks right', likely: 'Likely', maybe: 'Possible' };

export default function PaymentsIn() {
  const [tab, setTab] = useState('new');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load(t = tab) {
    setErr('');
    try {
      const r = await fetch(`/api/admin/payments-in?status=${t}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load.');
      setRows(j.deposits);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(tab); }, [tab]);

  async function act(body, ok) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/admin/payments-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      setMsg(ok(j)); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="panel">
        <h1 style={{ marginTop: 0, fontSize: 20 }}>Payments in</h1>
        <p style={{ fontSize: 14, marginTop: 0 }}>E-transfers that have landed in the bank, matched to the order or invoice they probably pay.
          Pressing <b>Confirm</b> marks that order paid (and starts any seller&rsquo;s 24-hour clock), so check the name and the amount first.
          Nothing is confirmed for you.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['new', 'To match'], ['matched', 'Matched'], ['ignored', 'Set aside']].map(([k, label]) => (
            <button key={k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{label}</button>))}
        </div>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
        {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      {rows === null ? <div className="panel">Loading…</div> : rows.length === 0 ? (
        <div className="panel" style={{ fontSize: 14 }}>{tab === 'new'
          ? 'No unmatched e-transfers. They appear here after the nightly bank pull, or when you press “Pull now” on the Financial tab.' : 'Nothing here.'}</div>
      ) : rows.map((d) => (
        <div className="panel" key={d.id}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{money(d.amountCents)}</span>
            <span>{d.sender || 'Unknown sender'}</span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{d.receivedOn}</span>
            {d.status !== 'new' && <span className="pill">{d.status === 'matched' ? `Matched to ${d.matchedRef || '—'} by ${d.matchedBy}` : `Set aside${d.note ? `: ${d.note}` : ''}`}</span>}
          </div>
          {d.memo && d.memo !== d.sender && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.memo}</div>}
          {d.status === 'new' && (
            <div style={{ marginTop: 10 }}>
              {d.suggestions.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No open order or invoice looks like this. It may be for something already marked paid, or a different account.</div>}
              {d.suggestions.map((s) => (
                <div key={`${s.kind}-${s.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--line, #eee)' }}>
                  <span className={`pill ${TONE[s.confidence]}`}>{WORD[s.confidence]}</span>
                  <b>{s.ref}</b> <span>{s.name}</span> <span>owes {money(s.owingCents)}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.why.join(' · ')}</span>
                  <button className={`btn${s.confidence === 'sure' ? ' primary' : ''}`} disabled={busy}
                    onClick={() => confirm(`Mark ${s.ref} (${s.name}) as paid with this ${money(d.amountCents)} e-transfer?`) && act({ action: 'confirm', depositId: d.id, kind: s.kind, id: s.id }, (j) => `${j.ref} marked paid.`)}>Confirm</button>
                </div>))}
              <div style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy} onClick={() => { const note = prompt('Why is this one not for an order? (e.g. owner transfer, refund from a supplier)'); if (note !== null) act({ action: 'ignore', depositId: d.id, note }, () => 'Set aside.'); }}>Not an order payment</button>
              </div>
            </div>)}
        </div>))}
    </div>
  );
}
