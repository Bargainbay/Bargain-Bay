'use client';
import { Fragment, useState } from 'react';

// Per person: what they are owed for work, what has been paid (cash from the till or a bank transfer), and the
// balance. "Owed" is typed from the payroll figure for a period; a payment is what actually left.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const span = (l) => (l.periodStart ? `${l.periodStart} to ${l.periodEnd}` : '');

export default function Payroll({ d, setD }) {
  const people = d.pay?.people || [];
  const names = d.pay?.names || [];
  const [owed, setOwed] = useState({ person: '', periodStart: '', periodEnd: '', amount: '', note: '' });
  const [paid, setPaid] = useState({ person: '', amount: '', date: d.date, how: 'cash', periodStart: '', periodEnd: '', note: '', expenseId: '' });
  const [cands, setCands] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function call(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewDate: d.date, days: d.days, ...body }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'That failed.');
      if (j.candidates) return j;
      setD(j); return j;
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  async function findLines() {
    const j = await call({ action: 'candidates', amount: paid.amount, date: paid.date }, 'cand');
    if (j) setCands(j.candidates);
  }
  async function addOwed(e) {
    e.preventDefault();
    const j = await call({ action: 'owed', ...owed }, 'owed');
    if (j) { setOwed({ person: '', periodStart: '', periodEnd: '', amount: '', note: '' }); setMsg('Added to what is owed.'); }
  }
  async function addPaid(e) {
    e.preventDefault();
    const j = await call({ action: 'pay', ...paid }, 'pay');
    if (j) {
      setMsg(paid.how === 'cash' ? 'Recorded. It is a wages expense and came out of the till.' : paid.expenseId ? 'Recorded and linked to the bank line, marked as wages.' : 'Recorded. It links to the bank line when the bank shows it.');
      setPaid((p) => ({ ...p, amount: '', note: '', expenseId: '' })); setCands(null);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Payroll — owed and paid</h2>
      <datalist id="pay-names">{names.map((n) => <option key={n} value={n} />)}</datalist>

      {people.length === 0 ? <p className="hint" style={{ margin: 0 }}>Nobody yet. Add what someone is owed for a pay period, then record each payment.</p> : (
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Person</th><th style={{ textAlign: 'right' }}>Owed</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr></thead>
          <tbody>
            {people.map((p) => (
              <Fragment key={p.person}>
                <tr>
                  <td><b>{p.person}</b></td>
                  <td style={{ textAlign: 'right' }}>{cad(p.owed)}</td>
                  <td style={{ textAlign: 'right' }}>{cad(p.paid)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: p.balance > 0 ? 'var(--danger)' : p.balance < 0 ? 'var(--c4)' : 'var(--c1)' }}>
                    {p.balance > 0 ? `owed ${cad(p.balance)}` : p.balance < 0 ? `overpaid ${cad(-p.balance)}` : 'settled'}</td>
                  <td style={{ textAlign: 'right' }}><button className="dash-filter" onClick={() => setOpen(open === p.person ? null : p.person)}>{open === p.person ? 'Hide' : 'Details'}</button></td>
                </tr>
                {open === p.person && p.lines.map((l) => (
                  <tr key={`${p.person}${l.id}`}>
                    <td colSpan={5} style={{ fontSize: 13.5 }}>
                      {l.kind === 'owed'
                        ? <>Owed <b>{cad(l.amount)}</b> for {span(l) || 'a period'}</>
                        : <>Paid <b>{cad(l.amount)}</b> on {l.paidOn} · {l.how === 'cash' ? 'cash from the till' : l.waitingForBank ? 'bank transfer (waiting for the bank to show it)' : 'bank transfer'}{span(l) ? ` · for ${span(l)}` : ''}</>}
                      {l.note ? ` · ${l.note}` : ''}{' '}
                      <button className="dash-filter" disabled={!!busy} onClick={() => window.confirm('Void this line?') && call({ action: 'void', id: l.id }, 'void')}>Void</button>
                    </td>
                  </tr>))}
              </Fragment>
            ))}
          </tbody></table></div>
      )}

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 14 }}>
        <form onSubmit={addOwed}>
          <b>Add what is owed</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
            <label>Who<br /><input list="pay-names" value={owed.person} onChange={(e) => setOwed({ ...owed, person: e.target.value })} required style={{ width: 130 }} /></label>
            <label>Period from<br /><input type="date" value={owed.periodStart} onChange={(e) => setOwed({ ...owed, periodStart: e.target.value })} required /></label>
            <label>to<br /><input type="date" value={owed.periodEnd} onChange={(e) => setOwed({ ...owed, periodEnd: e.target.value })} required /></label>
            <label>Amount<br /><input type="number" step="0.01" min="0" value={owed.amount} onChange={(e) => setOwed({ ...owed, amount: e.target.value })} required style={{ width: 100 }} /></label>
            <label style={{ flex: '1 1 140px' }}>Note<br /><input value={owed.note} onChange={(e) => setOwed({ ...owed, note: e.target.value })} style={{ width: '100%' }} /></label>
            <button className="btn accent" disabled={!!busy}>{busy === 'owed' ? 'Adding…' : 'Add owed'}</button>
          </div>
        </form>

        <form onSubmit={addPaid}>
          <b>Record a payment</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
            <label>Who<br /><input list="pay-names" value={paid.person} onChange={(e) => setPaid({ ...paid, person: e.target.value })} required style={{ width: 130 }} /></label>
            <label>Amount<br /><input type="number" step="0.01" min="0" value={paid.amount} onChange={(e) => { setPaid({ ...paid, amount: e.target.value, expenseId: '' }); setCands(null); }} required style={{ width: 100 }} /></label>
            <label>Date<br /><input type="date" value={paid.date} onChange={(e) => setPaid({ ...paid, date: e.target.value })} /></label>
            <label>How<br />
              <select value={paid.how} onChange={(e) => { setPaid({ ...paid, how: e.target.value, expenseId: '' }); setCands(null); }}>
                <option value="cash">Cash from the till</option><option value="bank">Bank e-transfer</option></select></label>
            <label>For period from<br /><input type="date" value={paid.periodStart} onChange={(e) => setPaid({ ...paid, periodStart: e.target.value })} /></label>
            <label>to<br /><input type="date" value={paid.periodEnd} onChange={(e) => setPaid({ ...paid, periodEnd: e.target.value })} /></label>
            <label style={{ flex: '1 1 120px' }}>Note<br /><input value={paid.note} onChange={(e) => setPaid({ ...paid, note: e.target.value })} style={{ width: '100%' }} /></label>
            <button className="btn accent" disabled={!!busy}>{busy === 'pay' ? 'Saving…' : 'Record payment'}</button>
          </div>
          {paid.how === 'bank' && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="dash-filter" disabled={!paid.amount || !!busy} onClick={findLines}>Find the bank line</button>
              {cands && cands.length === 0 && <span className="hint"> None for that amount yet — record it anyway and it links when the bank shows it.</span>}
              {cands && cands.map((c) => (
                <label key={c.id} style={{ display: 'block', marginTop: 4 }}>
                  <input type="radio" name="payline" checked={String(paid.expenseId) === String(c.id)} onChange={() => setPaid({ ...paid, expenseId: c.id })} /> {c.date} · {c.who} · {cad(c.gross)}</label>))}
            </div>
          )}
        </form>
      </div>
      <p className="hint" style={{ margin: '10px 0 0' }}>
        A cash payment is a wages expense and comes out of the till. A bank payment marks the e-transfer as wages (no HST) and names the person — it does not add a second cost.
      </p>
      {err && <div className="error-box" style={{ marginTop: 8 }}>{err}</div>}
      {msg && <div className="notice-box" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
