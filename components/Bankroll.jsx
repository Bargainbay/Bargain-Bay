'use client';
import { useState } from 'react';
import Receipts from './Receipts';

// The first thing on the Financial page: what we have right now, then the way to add to it.
// Cash SALES are never typed here (they are already in the system as cash payments); what is typed is
// cash SPENT, on a receipt, and the odd bit of cash or bank movement that has no document.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const signed = (v) => `${v < 0 ? '−' : '+'}${cad(Math.abs(v))}`;
const ago = (m) => (m == null ? 'never' : m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);

export default function Bankroll({ initial }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [other, setOther] = useState({ kind: 'cash', direction: 'in', amount: '', note: '', date: initial.date });
  const [count, setCount] = useState('');

  async function call(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/bankroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewDate: d.date, date: d.date, ...body }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'That failed.');
      setD(r);
      if (r.notes && r.notes.length) setErr(r.notes.join(' · '));
      return r;
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function goto(date) {
    setBusy('day'); setErr('');
    try { const r = await (await fetch(`/api/admin/bankroll?date=${date}`)).json(); if (r.error) throw new Error(r.error); setD(r); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function addOther(e) {
    e.preventDefault();
    const r = await call({ action: 'add', ...other }, 'other');
    if (r) { setOther((o) => ({ ...o, amount: '', note: '' })); setMsg('Added.'); }
  }
  async function saveCount(e) {
    e.preventDefault();
    const r = await call({ action: 'add', kind: 'count', amount: count, note: 'Cash counted' }, 'count');
    if (r) { setCount(''); setMsg('Cash count saved. From now on cash sales and cash spent move it.'); }
  }

  const { bank, cashParts } = d;
  const open = d.entries.filter((e) => e.kind === 'pending' && !e.cleared && !e.voided);
  return (
    <div>
      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="hint" style={{ margin: 0 }}>Bankroll — what we have right now</div>
        <div style={{ fontSize: 44, fontWeight: 800, margin: '4px 0' }}>{cad(d.total)}</div>
        <div className="hint" style={{ margin: 0 }}>
          bank <b>{d.bankKnown ? cad(d.bank) : 'not read yet'}</b> · cash <b>{d.cashKnown ? cad(d.cash) : 'not counted'}</b> · on its way <b>{cad(d.pending)}</b>
        </div>
        {d.cashKnown && (
          <p className="hint" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Cash = {cad(cashParts.count)} counted {new Date(cashParts.countedAt).toLocaleDateString('en-CA')}
            {' '}+ {cad(cashParts.sales)} cash sales{cashParts.other ? ` ${cashParts.other < 0 ? '−' : '+'} ${cad(Math.abs(cashParts.other))} other cash` : ''} − {cad(cashParts.spent)} spent on receipts
          </p>
        )}
        <p className="hint" style={{ margin: '10px 0 0', color: bank.stale ? 'var(--danger)' : undefined }}>
          {bank.at
            ? <>Bank figure from <b>{ago(bank.minutesOld)}</b> ({new Date(bank.at).toLocaleString('en-CA')}).{bank.stale ? ' That is old — get the live balance before you trust the total.' : ''}</>
            : 'No bank balance has been read yet, so the total above leaves the bank out.'}
        </p>
        <button className="btn accent" disabled={!!busy} onClick={() => call({ action: 'live' }, 'live')} style={{ marginTop: 8 }}>
          {busy === 'live' ? 'Asking the bank…' : 'Get live balance'}
        </button>
        <p className="hint" style={{ margin: '6px 0 0', fontSize: 12 }}>Asks TD itself and pulls any new lines. A small per-call charge from Plaid applies.</p>
        <form onSubmit={saveCount} style={{ marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="hint" style={{ margin: 0 }}>{d.cashKnown ? 'Recount the till:' : 'Count the till and enter it:'}</span>
          <input type="number" step="0.01" min="0" value={count} onChange={(e) => setCount(e.target.value)} placeholder="$ in the till" required style={{ width: 130 }} />
          <button className="btn" disabled={!!busy}>{busy === 'count' ? 'Saving…' : 'Save count'}</button>
        </form>
        {(d.owed.count > 0 || d.waitingForBank > 0) && (
          <p className="hint" style={{ margin: '10px 0 0' }}>
            {d.owed.count > 0 && <>Owed back to people: <b>{cad(d.owed.amount)}</b> ({d.owed.count} receipt{d.owed.count === 1 ? '' : 's'}). </>}
            {d.waitingForBank > 0 && <>{d.waitingForBank} card receipt{d.waitingForBank === 1 ? '' : 's'} waiting for the bank to show {d.waitingForBank === 1 ? 'it' : 'them'}.</>}
          </p>
        )}
      </div>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}

      <Receipts d={d} setD={setD} />

      <details className="panel" style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Other money in or out — the odd one with no receipt</summary>
        <form onSubmit={addOther} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 10 }}>
          <label>What<br />
            <select value={other.kind} onChange={(e) => setOther((o) => ({ ...o, kind: e.target.value }))}>
              <option value="cash">Cash, outside a sale or receipt</option>
              <option value="pending">Through the bank, not showing yet</option>
            </select></label>
          <label>Direction<br />
            <select value={other.direction} onChange={(e) => setOther((o) => ({ ...o, direction: e.target.value }))}>
              <option value="in">Money in</option><option value="out">Money out</option>
            </select></label>
          <label>Amount<br /><input type="number" step="0.01" min="0" value={other.amount} onChange={(e) => setOther((o) => ({ ...o, amount: e.target.value }))} required style={{ width: 110 }} /></label>
          <label>Date<br /><input type="date" value={other.date} onChange={(e) => setOther((o) => ({ ...o, date: e.target.value }))} /></label>
          <label style={{ flex: '1 1 200px' }}>Note<br /><input value={other.note} onChange={(e) => setOther((o) => ({ ...o, note: e.target.value }))} placeholder="scrap yard, cash sale with no invoice, cash deposited…" style={{ width: '100%' }} /></label>
          <button className="btn accent" disabled={!!busy}>{busy === 'other' ? 'Adding…' : 'Add'}</button>
        </form>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Cash sales with an invoice are already counted — do not add them here. Use this for cash that came in with no sale
          (scrap yard, a cash sale with no invoice), cash taken out to deposit, or a transfer you sent that the bank has not shown yet.
        </p>
      </details>

      {open.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>On its way through the bank ({open.length})</h2>
          <div className="table-wrap"><table className="admin"><tbody>
            {open.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td><td>{e.note || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{signed(e.amount)}</td>
                <td style={{ fontSize: 12 }}>{e.bankShows ? <b style={{ color: 'var(--c1)' }}>The bank now shows {cad(e.bankShows.gross)} to {e.bankShows.who} on {e.bankShows.date}</b> : ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="dash-filter active" disabled={!!busy} onClick={() => call({ action: 'clear', id: e.id }, 'row')}>Bank shows it</button>{' '}
                  <button className="dash-filter" disabled={!!busy} onClick={() => window.confirm('Void this entry?') && call({ action: 'void', id: e.id }, 'row')}>Void</button>
                </td>
              </tr>))}
          </tbody></table></div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>The day</h2>
          <input type="date" value={d.date} onChange={(e) => e.target.value && goto(e.target.value)} />
          <span className="hint" style={{ margin: 0 }}>Net for the day: <b>{signed(d.day.net)}</b></span>
        </div>
        <div className="table-wrap"><table className="admin"><tbody>
          {[...d.day.out.map((l) => ({ ...l, tag: 'Bank out' })), ...d.day.in.map((l) => ({ ...l, tag: 'Bank in' })),
            ...d.day.cashOut.map((l) => ({ ...l, tag: 'Cash out' })), ...d.day.cashIn.map((l) => ({ ...l, tag: 'Cash sale' })),
            ...d.day.mine.map((l) => ({ id: `e${l.id}`, who: l.note, amount: l.amount, tag: l.kind === 'cash' ? 'Cash' : 'Through the bank' }))]
            .map((l) => (<tr key={`${l.tag}${l.id}`}><td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.tag}</td><td>{l.who || '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{signed(l.amount)}</td></tr>))}
          {!d.day.out.length && !d.day.in.length && !d.day.cashOut.length && !d.day.cashIn.length && !d.day.mine.length && <tr><td colSpan={3} className="hint">Nothing recorded for this day.</td></tr>}
        </tbody></table></div>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Bank out is every card and e-transfer payment the bank reported; Bank in shows e-transfers received; cash lines come from cash sales and cash receipts.
          Other deposits (cash deposited, card payouts) are not in the bank feed yet — add them under &ldquo;Other money&rdquo; if they matter to today&apos;s number.
        </p>
      </div>
    </div>
  );
}
