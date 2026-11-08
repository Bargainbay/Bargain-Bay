'use client';
import { useState } from 'react';

// The live bankroll: the number first, then the day's ledger, then what you add by hand.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const signed = (v) => `${v < 0 ? '−' : '+'}${cad(Math.abs(v))}`;
const ago = (m) => (m == null ? 'never' : m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);

export default function Bankroll({ initial }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ kind: 'cash', direction: 'in', amount: '', note: '', date: initial.date });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function call(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/bankroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: d.date, ...body }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'That failed.');
      setD(r);
      if (r.notes && r.notes.length) setErr(r.notes.join(' · '));
      return r;
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function goto(date) {
    setBusy('day'); setErr('');
    try { const r = await (await fetch(`/api/admin/bankroll?date=${date}`)).json(); if (r.error) throw new Error(r.error); setD(r); set('date', date); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function add(e) {
    e.preventDefault();
    const r = await call({ action: 'add', ...form }, 'add');
    if (r) { set('amount', ''); set('note', ''); setMsg('Added.'); }
  }

  const { bank } = d;
  const open = d.entries.filter((e) => e.kind === 'pending' && !e.cleared && !e.voided);
  return (
    <div>
      <h1 style={{ margin: '0 0 14px' }}>Bankroll</h1>

      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="hint" style={{ margin: 0 }}>Live bankroll</div>
        <div style={{ fontSize: 44, fontWeight: 800, margin: '4px 0' }}>{cad(d.total)}</div>
        <div className="hint" style={{ margin: 0 }}>
          bank <b>{d.bankKnown ? cad(d.bank) : 'not read yet'}</b> · cash <b>{cad(d.cash)}</b> · on its way <b>{cad(d.pending)}</b>
        </div>
        <p className="hint" style={{ margin: '10px 0 0', color: bank.stale ? 'var(--danger)' : undefined }}>
          {bank.at
            ? <>Bank figure from <b>{ago(bank.minutesOld)}</b> ({new Date(bank.at).toLocaleString('en-CA')}).{bank.stale ? ' That is old — get the live balance before you trust the total.' : ''}</>
            : 'No bank balance has been read yet, so the total above is cash and pending only.'}
        </p>
        <button className="btn accent" disabled={!!busy} onClick={() => call({ action: 'live' }, 'live')} style={{ marginTop: 8 }}>
          {busy === 'live' ? 'Asking the bank…' : 'Get live balance'}
        </button>
        <p className="hint" style={{ margin: '6px 0 0', fontSize: 12 }}>Asks TD itself and pulls any new lines. A small per-call charge from Plaid applies.</p>
      </div>

      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Add to the ledger</h2>
        <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>What<br />
            <select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="cash">Cash (in the till / pocket)</option>
              <option value="pending">Through the bank, not showing yet</option>
            </select></label>
          <label>Direction<br />
            <select value={form.direction} onChange={(e) => set('direction', e.target.value)}>
              <option value="in">Money in</option><option value="out">Money out</option>
            </select></label>
          <label>Amount<br /><input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} required style={{ width: 110 }} /></label>
          <label>Date<br /><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label style={{ flex: '1 1 200px' }}>Note<br /><input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="who / what for" style={{ width: '100%' }} /></label>
          <button className="btn accent" disabled={!!busy}>{busy === 'add' ? 'Adding…' : 'Add'}</button>
        </form>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          <b>Cash</b> counts until you add the opposite entry (start with a first entry for what is in the till today).
          <b> Through the bank</b> counts only until the bank shows it, then you clear it so it isn&apos;t counted twice.
        </p>
      </div>

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
            ...d.day.mine.map((l) => ({ id: `e${l.id}`, who: l.note, amount: l.amount, tag: l.kind === 'cash' ? 'Cash' : 'Through the bank' }))]
            .map((l) => (<tr key={`${l.tag}${l.id}`}><td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.tag}</td><td>{l.who || '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{signed(l.amount)}</td></tr>))}
          {!d.day.out.length && !d.day.in.length && !d.day.mine.length && <tr><td colSpan={3} className="hint">Nothing recorded for this day.</td></tr>}
        </tbody></table></div>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Bank out is every card and e-transfer payment the bank reported; Bank in shows e-transfers received. Other deposits (cash deposited, card payouts) are not in the feed yet — enter them above if they matter to today&apos;s number.
        </p>
      </div>
    </div>
  );
}
