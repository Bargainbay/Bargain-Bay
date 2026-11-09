'use client';
import { Fragment, useEffect, useState } from 'react';
import Receipts from './Receipts';

const CATS = ['Wages', 'Rent / storage', 'Utilities', 'Insurance', 'Software', 'Truck (lease, plates, upkeep)', 'Fuel', 'Delivery (carriers we pay)',
  'Tools / supplies', 'Advertising - Google', 'Advertising - Facebook / Instagram', 'Advertising - Other', 'Card & bank fees', 'Interest charges', 'Loan repayment', 'Owner draw - Ravi', 'Owner draw - Sai', 'Other'];
const NEW_CAT = '__new';
const catLabel = (c) => (c === 'Wages' ? 'Wages / salary' : c);

// The first thing on the Financial page: what we have right now, then the way to add to it.
// Cash SALES are never typed here (they are already in the system as cash payments); what is typed is
// cash SPENT, on a receipt, and the odd bit of cash or bank movement that has no document.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const signed = (v) => `${v < 0 ? '−' : '+'}${cad(Math.abs(v))}`;
const ago = (m) => (m == null ? 'never' : m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`);

const INCOME_CATS = ['Product sale', 'Service sale', 'Deposit on an order', 'Refund or credit received', 'Loan or owner money in', 'Scrap or other sale'];

export default function Bankroll({ initial }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [other, setOther] = useState({ kind: 'cash', direction: 'in', amount: '', note: '', date: initial.date });
  const [count, setCount] = useState('');
  const [thru, setThru] = useState({ direction: 'out', amount: '', payee: '', category: 'Wages', note: '', date: initial.date });
  const [countDate, setCountDate] = useState(initial.date);
  const [payTo, setPayTo] = useState({});
  const [openRow, setOpenRow] = useState(null);
  const cats = [...CATS, ...(d.customCategories || []).filter((c) => !CATS.includes(c))];
  // Picking "+ Add a category…" asks for a name, saves it for everybody, then carries on with it as the choice.
  async function withCategory(value, then) {
    if (value !== NEW_CAT) return then(value);
    const name = window.prompt('Name the new category (for example "Packaging")');
    if (!name || !name.trim()) return null;
    const r = await call({ action: 'add_category', name }, 'cat');
    if (!r) return null;
    const added = (r.customCategories || []).find((c) => c.toLowerCase() === name.trim().replace(/\s+/g, ' ').toLowerCase()) || name.trim();
    return then(added);
  }
  const [split, setSplit] = useState(null); // { key, id, total, parts: [{ category, amount }] }
  const startSplit = (l) => setSplit({ key: l.key, id: l.activityId, total: Math.round(Math.abs(l.amount) * 100) / 100, parts: [{ category: '', amount: '' }, { category: '', amount: '' }] });
  const splitLeft = split ? Math.round((split.total - split.parts.reduce((t, p) => t + (Number(p.amount) || 0), 0)) * 100) / 100 : 0;
  async function saveSplit() {
    const r = await call({ action: 'split', activityId: split.id, parts: split.parts.map((p) => ({ category: p.category, amount: Number(p.amount) })) }, 'cat');
    if (r) { setSplit(null); setMsg('Split. Each part is now its own expense in its category.'); }
  }

  // The server refreshes the bank itself every 30 minutes; the page re-reads what it holds every 5 minutes while it is open
  // (no call to the bank, so no charge) so a tab left up keeps showing the latest.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try { const r = await (await fetch(`/api/admin/bankroll?days=${d.days}`)).json(); if (r && !r.error) setD(r); } catch { /* try again next time */ }
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [d.days]);

  async function call(body, label, url = '/api/admin/bankroll') {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewDate: d.date, date: d.date, days: d.days, ...body }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'That failed.');
      setD(r);
      if (r.notes && r.notes.length) setErr(r.notes.join(' · '));
      return r;
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function range(days) {
    setBusy('day'); setErr('');
    try { const r = await (await fetch(`/api/admin/bankroll?days=${days}`)).json(); if (r.error) throw new Error(r.error); setD(r); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  // Re-categorise one bank line from the live list. Wages carry no HST.
  async function setCategory(row, category) {
    setBusy('cat'); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'categorize', ids: [row.expenseId], category, taxMode: category === 'Wages' ? 'none' : '' }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'That failed.');
      await range(d.days);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  async function assignPay(row) {
    const person = (payTo[row.expenseId] || '').trim();
    if (!person) { setErr('Type who it was paid to.'); return; }
    const r = await call({ action: 'pay', person, amount: Math.abs(row.amount), date: row.date, how: 'bank', expenseId: row.expenseId, days: d.days }, 'assign', '/api/admin/pay');
    if (r) setMsg(`Counted as a payment to ${person}.`);
  }
  async function addOther(e) {
    e.preventDefault();
    const r = await call({ action: 'add', ...other }, 'other');
    if (r) { setOther((o) => ({ ...o, amount: '', note: '' })); setMsg('Added.'); }
  }
  async function addThru(e) {
    e.preventDefault();
    const r = await call({ action: 'add', kind: 'pending', direction: thru.direction, amount: thru.amount, date: thru.date,
      note: thru.note || (thru.payee ? `${thru.direction === 'out' ? 'To' : 'From'} ${thru.payee}` : ''), category: thru.direction === 'out' ? thru.category : '', payee: thru.payee }, 'thru');
    if (r) { setThru((t) => ({ ...t, amount: '', payee: '', note: '' })); setMsg('Added. It counts in the bankroll now. When the bank shows it, press "Bank shows it" and it is sorted for you.'); }
  }
  async function changePaymentMethod(row, method) {
    if (!window.confirm(`Change this ${row.invoice?.number || ''} payment from cash to ${method === 'etransfer' ? 'an e-transfer' : method}? It comes out of the cash total. The invoice and the amount do not change.`)) return;
    const r = await call({ action: 'payment_method', paymentId: row.paymentId, method }, 'cat');
    if (r) setMsg('Changed. It no longer counts as cash.');
  }
  async function sortIncomeLine(row, category) {
    const r = await call({ action: 'sort_income', activityId: row.incomeId, category }, 'cat');
    if (r) setMsg('Saved.');
  }
  async function promote(row, category) {
    const r = await call({ action: 'promote', activityId: row.activityId, category }, 'cat');
    if (r) setMsg('Sorted. It is now an expense in that category.');
  }
  async function saveCount(e) {
    e.preventDefault();
    const r = await call({ action: 'add', kind: 'count', amount: count, date: countDate, note: 'Cash counted' }, 'count');
    if (r) { setCount(''); setMsg('Cash count saved. From now on cash sales and cash spent move it.'); }
  }

  // `d.bank` is the dollar figure; the bank's own details (when it was read, how old) are `d.bankInfo`.
  const bank = d.bankInfo;
  const { cashParts } = d;
  const open = d.entries.filter((e) => e.kind === 'pending' && !e.cleared && !e.voided);
  return (
    <div className="bankroll">
      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="hint" style={{ margin: 0 }}>Bankroll — what we have right now</div>
        <div style={{ fontSize: 44, fontWeight: 800, margin: '4px 0' }}>{cad(d.total)}</div>
        <div className="hint" style={{ margin: 0 }}>
          bank <b>{d.bankKnown ? cad(d.bank) : 'not read yet'}</b> · cash <b>{d.cashKnown ? cad(d.cash) : 'not counted'}</b> · on its way <b>{cad(d.pending)}</b>
        </div>
        {d.cashKnown && (
          <p className="hint" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Cash = {cad(cashParts.count)} counted for {cashParts.countedOn}
            {' '}+ {cad(cashParts.sales)} cash sales{cashParts.other ? ` ${cashParts.other < 0 ? '−' : '+'} ${cad(Math.abs(cashParts.other))} other cash` : ''} − {cad(cashParts.spent)} spent on receipts
          </p>
        )}
        <p className="hint" style={{ margin: '10px 0 0', color: bank.stale ? 'var(--danger)' : undefined }}>
          {bank.at
            ? <>Bank figure from <b>{ago(bank.minutesOld)}</b> ({new Date(bank.at).toLocaleString('en-CA')}).{bank.stale ? ' That is old — get the live balance before you trust the total.' : ''}</>
            : 'No bank balance has been read yet, so the total above leaves the bank out.'}
        </p>
        {d.bankNewest && (
          <p className="hint" style={{ margin: '6px 0 0' }}>
            Newest line TD has sent us: <b>{d.bankNewest}</b>.{d.bankNewest < d.date ? <> Anything since is <b>not here yet</b>. TD passes lines on a business day at a time, so a weekend&apos;s e-transfers show up on Monday. Add them below so the bankroll is right now.</> : ''}
          </p>)}
        <button className="btn accent" disabled={!!busy} onClick={() => call({ action: 'live' }, 'live')} style={{ marginTop: 8 }}>
          {busy === 'live' ? 'Asking the bank…' : 'Get live balance'}
        </button>
        <p className="hint" style={{ margin: '6px 0 0', fontSize: 12 }}>Asks TD itself and pulls any new lines. A small per-call charge from Plaid applies.</p>
        <form onSubmit={saveCount} style={{ marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="hint" style={{ margin: 0 }}>{d.cashKnown ? 'Recount the till:' : 'Count the till and enter it:'}</span>
          <input type="number" step="0.01" min="0" value={count} onChange={(e) => setCount(e.target.value)} placeholder="$ in the till" required style={{ width: 130 }} />
          <span className="hint" style={{ margin: 0 }}>at the end of</span>
          <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} />
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

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sent or received through the bank — not showing yet</h2>
        <form onSubmit={addThru} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>Which way<br />
            <select value={thru.direction} onChange={(e) => setThru({ ...thru, direction: e.target.value })}>
              <option value="out">I sent money</option><option value="in">I received money</option></select></label>
          <label>Amount<br /><input type="number" step="0.01" min="0" value={thru.amount} onChange={(e) => setThru({ ...thru, amount: e.target.value })} required style={{ width: 110 }} /></label>
          <label>{thru.direction === 'out' ? 'Paid to' : 'From'}<br /><input list="live-names" value={thru.payee} onChange={(e) => setThru({ ...thru, payee: e.target.value })} placeholder="name" style={{ width: 150 }} /></label>
          {thru.direction === 'out' && (
            <label>Category<br />
              <select value={thru.category} onChange={(e) => withCategory(e.target.value, (v) => setThru((t) => ({ ...t, category: v })))}>
                {cats.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}<option value={NEW_CAT}>+ Add a category…</option></select></label>)}
          <label>Date<br /><input type="date" value={thru.date} onChange={(e) => setThru({ ...thru, date: e.target.value })} /></label>
          <label style={{ flex: '1 1 160px' }}>Note<br /><input value={thru.note} onChange={(e) => setThru({ ...thru, note: e.target.value })} style={{ width: '100%' }} /></label>
          <button className="btn accent" disabled={!!busy}>{busy === 'thru' ? 'Adding…' : 'Add'}</button>
        </form>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          For what you did today that TD has not passed on yet (it lags by a business day). It counts in the bankroll straight away.
          When the bank shows the line, press <b>Bank shows it</b> and the category and name are put on it, so you do not type it twice.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Live transactions</h2>
          {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([n, l]) => (
            <button key={n} type="button" className={'dash-filter' + (d.days === n ? ' active' : '')} disabled={!!busy} onClick={() => range(n)}>{l}</button>))}
          <span className="hint" style={{ margin: 0 }}>Everything in one list. Click a row for the details. Refreshes itself every 30 minutes.</span>
        </div>
        <datalist id="live-names">{(d.pay?.names || []).map((n) => <option key={n} value={n} />)}</datalist>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Date</th><th>Type</th><th>Who / what</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {d.live.map((l) => (
              <Fragment key={l.key}>
                <tr onClick={() => setOpenRow(openRow === l.key ? null : l.key)} style={{ cursor: 'pointer', opacity: l.pending ? 0.8 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }}><span aria-hidden="true">{openRow === l.key ? '▾' : '▸'}</span> {l.date}</td>
                  <td style={{ fontSize: 12.5 }}>{l.tag}{l.pending && <span className="hint" style={{ marginLeft: 4 }}>(pending)</span>}</td>
                  <td>
                    {l.invoice
                      ? <><a href={l.invoice.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><b>{l.invoice.number}</b></a> · {l.invoice.customer || 'no name on the invoice'}</>
                      : (l.who || '—')}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {l.expenseId ? (
                      <>
                        <select value={l.category || ''} disabled={!!busy} onChange={(e) => e.target.value && withCategory(e.target.value, (v) => setCategory(l, v))} style={{ minHeight: 34, padding: '4px 8px', fontSize: 14 }}>
                          <option value="">Choose…</option>
                          {l.category && !cats.includes(l.category) && <option value={l.category}>{l.category}</option>}
                          {cats.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}<option value={NEW_CAT}>+ Add a category…</option>
                        </select>
                        {l.category === 'Wages' && !l.inPayroll && (
                          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
                            <input list="live-names" placeholder="paid to…" value={payTo[l.expenseId] || ''} onChange={(e) => setPayTo((p) => ({ ...p, [l.expenseId]: e.target.value }))} style={{ width: 120, minHeight: 34, padding: '4px 8px', fontSize: 14 }} />
                            <button type="button" className="dash-filter active" disabled={!!busy} onClick={() => assignPay(l)}>Count as pay</button>
                          </span>
                        )}
                        {l.inPayroll && <span className="hint" style={{ marginLeft: 6 }}>in payroll</span>}
                      </>
                    ) : l.activityId ? (
                      <select value="" disabled={!!busy} onChange={(e) => { const v = e.target.value; if (v === '__split') startSplit(l); else if (v) withCategory(v, (c) => promote(l, c)); }} style={{ minHeight: 34, padding: '4px 8px', fontSize: 14 }} title="The bank calls this a transfer. Pick what it was to count it as an expense.">
                        <option value="">Sort this…</option>
                        <option value="__split">Split into several…</option>
                        {cats.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}<option value={NEW_CAT}>+ Add a category…</option>
                      </select>
                    ) : l.incomeId ? (
                      <select value={l.incomeCategory || ''} disabled={!!busy} onChange={(e) => { const v = e.target.value; if (v === '__other') { const t = window.prompt('What was it? (write the category)'); if (t && t.trim()) sortIncomeLine(l, t.trim()); } else sortIncomeLine(l, v); }} style={{ minHeight: 34, padding: '4px 8px', fontSize: 14 }} title="What was this money for?">
                        <option value="">What was it?</option>
                        {INCOME_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                        {l.incomeCategory && !INCOME_CATS.includes(l.incomeCategory) && <option value={l.incomeCategory}>{l.incomeCategory}</option>}
                        <option value="__other">Other (write it in)…</option>
                      </select>
                    ) : l.paymentId ? (
                      <select value="" disabled={!!busy} onClick={(e) => e.stopPropagation()} onChange={(e) => e.target.value && changePaymentMethod(l, e.target.value)} style={{ minHeight: 34, padding: '4px 8px', fontSize: 14 }} title="Recorded as cash by mistake? Say how it was really paid. The invoice and the amount stay as they are.">
                        <option value="">Not cash?…</option>
                        <option value="etransfer">It was an e-transfer</option>
                        <option value="card">It was a card</option>
                        <option value="cheque">It was a cheque</option>
                        <option value="other">Other</option>
                      </select>
                    ) : (l.category || '')}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: l.noMoney ? 'var(--muted)' : undefined }}>{l.noMoney && l.tag === 'Till count' ? cad(l.amount) : signed(l.amount)}</td>
                </tr>
                {split && split.key === l.key && (
                  <tr>
                    <td colSpan={5} style={{ background: 'var(--card-2)', padding: '10px 16px' }}>
                      <b>Split {cad(split.total)} into parts</b>
                      {split.parts.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          <select value={p.category} onChange={(e) => withCategory(e.target.value, (v) => setSplit((s) => ({ ...s, parts: s.parts.map((x, j) => (j === i ? { ...x, category: v } : x)) })))} style={{ minHeight: 34, padding: '4px 8px', fontSize: 14 }}>
                            <option value="">Category…</option>
                            {cats.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}<option value={NEW_CAT}>+ Add a category…</option>
                          </select>
                          <input type="number" step="0.01" placeholder="amount" value={p.amount} onChange={(e) => setSplit((s) => ({ ...s, parts: s.parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) }))} style={{ width: 120, minHeight: 34, padding: '4px 8px', fontSize: 14 }} />
                          {split.parts.length > 2 && <button type="button" className="dash-filter" onClick={() => setSplit((s) => ({ ...s, parts: s.parts.filter((_, j) => j !== i) }))}>Remove</button>}
                        </div>))}
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" className="dash-filter" onClick={() => setSplit((s) => ({ ...s, parts: [...s.parts, { category: '', amount: splitLeft > 0 ? String(splitLeft) : '' }] }))}>+ Add a part</button>
                        <span className="hint" style={{ margin: 0 }}>{splitLeft === 0 ? 'Adds up.' : `${cad(Math.abs(splitLeft))} ${splitLeft > 0 ? 'still to place' : 'too much'}`}</span>
                        <button type="button" className="dash-filter active" disabled={!!busy || splitLeft !== 0 || split.parts.some((p) => !p.category || !(Number(p.amount) > 0))} onClick={saveSplit}>Save split</button>
                        <button type="button" className="dash-filter" onClick={() => setSplit(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>)}
                {openRow === l.key && (
                  <tr>
                    <td colSpan={5} style={{ background: 'var(--card-2)', padding: '10px 16px' }}>
                      {(l.detail?.fields || []).length === 0 && !(l.detail?.links || []).length && <span className="hint">Nothing more recorded on this one.</span>}
                      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px', margin: 0, fontSize: 14 }}>
                        {(l.detail?.fields || []).map(([k, v]) => (<Fragment key={k}><dt style={{ color: '#c3cad8', fontWeight: 600 }}>{k}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{v}</dd></Fragment>))}
                      </dl>
                      {(l.detail?.links || []).length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {l.detail.links.map((x) => (<a key={x.href} className="dash-filter active" href={x.href} target="_blank" rel="noreferrer">{x.label} →</a>))}
                        </div>)}
                    </td>
                  </tr>)}
              </Fragment>))}
            {!d.live.length && <tr><td colSpan={5} className="hint">Nothing in this range.</td></tr>}
          </tbody></table></div>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          New bank lines show here after <b>Get live balance</b>. Pick a category on any bank line; choose <b>Wages / salary</b> and name who was paid to put it on that person&apos;s payroll balance.
        </p>
      </div>

      <Receipts d={d} setD={setD} />

      <div className="panel" style={{ marginTop: 18 }}>
        <b>Payroll</b>{' '}
        <span className="hint" style={{ margin: 0 }}>hours, what each person earned, owed and paid:</span>{' '}
        <a href="/admin/payroll" style={{ textDecoration: 'underline' }}>open Payroll →</a>
        {(d.pay?.people || []).filter((p) => p.balance > 0).length > 0 && (
          <div className="hint" style={{ margin: '6px 0 0' }}>
            Owed now: {(d.pay.people || []).filter((p) => p.balance > 0).map((p) => `${p.person} ${cad(p.balance)}`).join(' · ')}
          </div>)}
      </div>

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
                <td>{e.date}</td><td>{e.note || '—'}{e.category && <div className="hint" style={{ margin: 0, fontSize: 12 }}>will be sorted as {catLabel(e.category)}{e.payee ? ` · ${e.payee}` : ''}</div>}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{signed(e.amount)}</td>
                <td style={{ fontSize: 12 }}>{e.bankShows ? <b style={{ color: 'var(--c1)' }}>The bank now shows {cad(e.bankShows.gross)} to {e.bankShows.who} on {e.bankShows.date}</b> : ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="dash-filter active" disabled={!!busy} onClick={() => call({ action: 'clear', id: e.id, line: e.bankShows ? { kind: e.bankShows.kind, id: e.bankShows.id } : null }, 'row')}>Bank shows it</button>{' '}
                  <button className="dash-filter" disabled={!!busy} onClick={() => window.confirm('Void this entry?') && call({ action: 'void', id: e.id }, 'row')}>Void</button>
                </td>
              </tr>))}
          </tbody></table></div>
        </div>
      )}

    </div>
  );
}
