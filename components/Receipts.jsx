'use client';
import { useRef, useState } from 'react';
import { compress } from './photo-pick';

// Snap a receipt, check what was read, say how it was paid. Then the tracker: has the bank shown it yet,
// and if somebody paid out of their own pocket, have they been paid back.
const cad = (v) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v));
const CATS = ['Rent / storage', 'Utilities', 'Insurance', 'Software', 'Truck (lease, plates, upkeep)', 'Fuel', 'Delivery (carriers we pay)', 'Wages',
  'Tools / supplies', 'Advertising - Google', 'Advertising - Facebook / Instagram', 'Advertising - Other', 'Card & bank fees', 'Interest charges', 'Other'];
const PAID = { cash: 'Cash from the till', bank: 'Business card / bank', personal: 'My own pocket (pay me back)' };
const blank = (date) => ({ vendor: '', date, total: '', tax: '', category: 'Tools / supplies', paidWith: 'cash', paidBy: '', reimburse: true, note: '' });

export default function Receipts({ d, setD }) {
  const [f, setF] = useState(blank(d.date));
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [view, setView] = useState('all');
  const [open, setOpen] = useState(null); // { id, mode: 'link' | 'back', candidates }
  const [back, setBack] = useState({ how: 'bank', on: d.date, bankExpenseId: '', note: '' });
  const camera = useRef(null), library = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function addOrSet(v) {
    if (v !== '__new') return set('category', v);
    const name = window.prompt('Name the new category (for example "Packaging")');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/admin/bankroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_category', name, viewDate: d.date, date: d.date, days: d.days }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'That failed.');
      setD(r);
      set('category', (r.customCategories || []).find((c) => c.toLowerCase() === name.trim().replace(/\s+/g, ' ').toLowerCase()) || name.trim());
    } catch (e) { setErr(e.message); }
  }

  async function pick(file) {
    if (!file) return;
    setErr(''); setMsg('');
    try {
      const blob = await compress(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setReading('Reading the receipt…');
      const fd = new FormData();
      fd.set('photo', blob, 'receipt.jpg');
      const r = await fetch('/api/admin/receipts/read', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setReading(''); setErr(j.error || 'Could not read it — type the details.'); return; }
      const g = j.read || {};
      setF((x) => ({ ...x, vendor: g.vendor || x.vendor, date: g.date || x.date, total: g.total ?? x.total, tax: g.tax ?? x.tax, category: g.category || x.category }));
      setReading(g.total ? 'Filled in from the photo — check every field before saving.' : 'Could not read the amount — type it in.');
    } catch { setReading(''); setErr('Could not use that photo.'); }
  }

  async function save(e) {
    e.preventDefault();
    setBusy('save'); setErr(''); setMsg('');
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ vendor: f.vendor, date: f.date, total: f.total, tax: f.tax, category: f.category, paidWith: f.paidWith, paidBy: f.paidBy, note: f.note, viewDate: d.date })) fd.set(k, v ?? '');
      fd.set('reimburse', f.reimburse ? 'yes' : 'no');
      if (photo) fd.set('photo', photo.blob, 'receipt.jpg');
      const res = await fetch('/api/admin/receipts', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `The server said ${res.status}.`);
      setD(j);
      const mine = (j.receipts || []).find((r) => r.id === j.savedId);
      setMsg(f.paidWith === 'cash' ? 'Saved. It is in the expenses and came out of the cash.'
        : f.paidWith === 'personal' ? `Saved as a cost. Owed back to ${f.paidBy}.`
        : mine?.bank?.state === 'linked' ? `Saved and matched to the bank line from ${mine.bank.who} on ${mine.bank.date}.`
        : 'Saved. Waiting for the bank to show the charge — it links itself when it does.');
      setF(blank(d.date)); setPhoto(null); setReading('');
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }

  async function act(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewDate: d.date, ...body }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'That failed.');
      if (j.candidates) return j;
      setD(j); setOpen(null); return j;
    } catch (x) { setErr(x.message); } finally { setBusy(''); }
  }
  async function showCandidates(r, mode) {
    const j = await act({ action: 'candidates', id: r.id, afterOnly: mode === 'back' }, 'cand');
    if (j) { setOpen({ id: r.id, mode, candidates: j.candidates }); setBack((b) => ({ ...b, bankExpenseId: '', how: mode === 'back' ? b.how : 'bank' })); }
  }

  const rows = (d.receipts || []).filter((r) => view === 'all' || (view === 'owed' && r.reimburse === 'owed') || (view === 'waiting' && r.bank && r.bank.state === 'waiting'));
  const owedN = (d.receipts || []).filter((r) => r.reimburse === 'owed').length;
  // Everything owed to one person, so a single transfer that paid them back can close all of it at once.
  const owedBy = {};
  for (const r of d.receipts || []) if (r.reimburse === 'owed') { const k = r.paidBy || 'Unnamed'; (owedBy[k] = owedBy[k] || []).push(r); }
  async function payBackAll(who) {
    const list = owedBy[who];
    const total = list.reduce((t, r) => t + Number(r.total), 0);
    if (!window.confirm(`Mark ${list.length} receipts (${cad(total)}) as paid back to ${who}? Use this when one transfer covered them all.`)) return;
    await act({ action: 'reimburse_many', ids: list.map((r) => r.id), how: 'bank', on: back.on, note: `Paid back ${who} in one transfer` }, 'backall');
  }
  const waitN = (d.receipts || []).filter((r) => r.bank && r.bank.state === 'waiting').length;

  return (
    <div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Add an expense — snap the receipt</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={library} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="btn accent" onClick={() => camera.current?.click()}>📷 Take photo</button>
          <button type="button" className="btn" onClick={() => library.current?.click()}>Choose from phone</button>
          {photo && <img src={photo.url} alt="receipt" style={{ height: 56, borderRadius: 6, border: '1px solid var(--line, #ddd)' }} />}
          {reading && <span className="hint" style={{ margin: 0 }}>{reading}</span>}
        </div>

        <form onSubmit={save} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 12 }}>
          <label style={{ flex: '1 1 180px' }}>Vendor<br /><input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="Home Depot" style={{ width: '100%' }} /></label>
          <label>Date<br /><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></label>
          <label>Total<br /><input type="number" step="0.01" min="0" value={f.total} onChange={(e) => set('total', e.target.value)} required style={{ width: 100 }} /></label>
          <label>HST inside<br /><input type="number" step="0.01" min="0" value={f.tax} onChange={(e) => set('tax', e.target.value)} placeholder="unknown" style={{ width: 100 }} /></label>
          <label>Category<br />
            <select value={f.category} onChange={(e) => addOrSet(e.target.value)}>{[...CATS, ...(d.customCategories || [])].map((c) => <option key={c}>{c}</option>)}<option value="__new">+ Add a category…</option></select></label>
          <label>How it was paid<br />
            <select value={f.paidWith} onChange={(e) => set('paidWith', e.target.value)}>
              {Object.entries(PAID).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {f.paidWith === 'personal' && (
            <>
              <label>Whose pocket<br /><input value={f.paidBy} onChange={(e) => set('paidBy', e.target.value)} placeholder="Ravi" required style={{ width: 120 }} /></label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.reimburse} onChange={(e) => set('reimburse', e.target.checked)} /> needs paying back</label>
            </>
          )}
          <label style={{ flex: '1 1 160px' }}>Note<br /><input value={f.note} onChange={(e) => set('note', e.target.value)} style={{ width: '100%' }} /></label>
          <button className="btn accent" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save expense'}</button>
        </form>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          <b>Cash</b>: counts as a cost and comes out of the till. <b>Card / bank</b>: the bank already carries the cost, so this just matches the receipt
          to that line and fills in its category and HST. <b>Own pocket</b>: counts as a cost, and stays owed back until you mark it paid.
          The photo is optional and private.
        </p>
        {err && <div className="error-box" style={{ marginTop: 8 }}>{err}</div>}
        {msg && <div className="notice-box" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Receipts</h2>
          {[['all', 'All'], ['owed', `Owed back (${owedN})`], ['waiting', `Waiting for the bank (${waitN})`]].map(([k, l]) => (
            <button key={k} type="button" className={'dash-filter' + (view === k ? ' active' : '')} onClick={() => setView(k)}>{l}</button>))}
        </div>
        {Object.keys(owedBy).length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.keys(owedBy).map((who) => (
              <button key={who} type="button" className="dash-filter active" disabled={!!busy} onClick={() => payBackAll(who)}>
                Mark all {owedBy[who].length} owed to {who} paid back ({cad(owedBy[who].reduce((t, r) => t + Number(r.total), 0))})</button>))}
          </div>
        )}
        {rows.length === 0 ? <p className="hint" style={{ margin: 0 }}>Nothing here yet.</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Date</th><th>Vendor</th><th style={{ textAlign: 'right' }}>Total</th><th>Paid with</th><th>Bank</th><th>Paid back</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.vendor || '—'}<div className="hint" style={{ margin: 0, fontSize: 12 }}>{r.category}{r.note ? ` · ${r.note}` : ''}</div></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(r.total)}{r.tax != null && <div className="hint" style={{ margin: 0, fontSize: 12 }}>HST {cad(r.tax)}</div>}</td>
                  <td>{r.paidWith === 'cash' ? 'Cash' : r.paidWith === 'bank' ? 'Card / bank' : `${r.paidBy}'s pocket`}</td>
                  <td>{r.bank ? (r.bank.state === 'linked' ? <span style={{ color: 'var(--c1)' }}>✓ {r.bank.who} · {r.bank.date}</span> : <b style={{ color: 'var(--danger)' }}>waiting</b>) : '—'}</td>
                  <td>{r.reimburse === 'owed' ? <b style={{ color: 'var(--danger)' }}>owed to {r.paidBy}</b> : r.reimburse === 'reimbursed' ? <span title={r.reimbursedNote || ''}>paid {r.reimbursedOn} ({r.reimbursedHow})</span> : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.hasPhoto && <a className="dash-filter" href={`/api/admin/receipts/photo?id=${r.id}`} target="_blank" rel="noreferrer">Photo</a>}{' '}
                    {r.bank && r.bank.state === 'waiting' && <button className="dash-filter" disabled={!!busy} onClick={() => showCandidates(r, 'link')}>Find bank line</button>}{' '}
                    {r.reimburse === 'owed' && <button className="dash-filter active" disabled={!!busy} onClick={() => { setOpen({ id: r.id, mode: 'back', candidates: null }); }}>Mark paid back</button>}{' '}
                    {!(r.reimburse === 'reimbursed' && r.reimbursedHow === 'bank') && <button className="dash-filter" disabled={!!busy} onClick={() => window.confirm('Void this receipt? Its expense is taken out too.') && act({ action: 'void', id: r.id }, 'void')}>Void</button>}
                  </td>
                </tr>))}
            </tbody></table></div>
        )}

        {open && open.mode === 'link' && (
          <div className="notice-box" style={{ marginTop: 10 }}>
            <b>Possible bank lines for receipt #{open.id}</b>
            {open.candidates.length === 0 && <div>None yet — the bank has not shown a charge of that amount. It links itself when it does.</div>}
            {open.candidates.map((c) => (
              <div key={c.id} style={{ marginTop: 6 }}>{c.date} · {c.who} · {cad(c.gross)}{' '}
                <button className="dash-filter active" disabled={!!busy} onClick={() => act({ action: 'link', id: open.id, expenseId: c.id }, 'link')}>This is it</button></div>))}
            <button className="dash-filter" style={{ marginTop: 6 }} onClick={() => setOpen(null)}>Close</button>
          </div>
        )}

        {open && open.mode === 'back' && (
          <div className="notice-box" style={{ marginTop: 10 }}>
            <b>Paid back — receipt #{open.id}</b>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
              <label>How<br />
                <select value={back.how} onChange={(e) => { const how = e.target.value; setBack((b) => ({ ...b, how })); if (how === 'bank') showCandidates({ id: open.id }, 'back'); }}>
                  <option value="bank">E-transfer from the bank</option><option value="cash">Cash from the till</option><option value="other">Some other way</option></select></label>
              <label>Date<br /><input type="date" value={back.on} onChange={(e) => setBack((b) => ({ ...b, on: e.target.value }))} /></label>
              <label style={{ flex: '1 1 160px' }}>Note<br /><input value={back.note} onChange={(e) => setBack((b) => ({ ...b, note: e.target.value }))} style={{ width: '100%' }} /></label>
              <button className="btn accent" disabled={!!busy || (back.how === 'bank' && !back.bankExpenseId)}
                onClick={() => act({ action: 'reimburse', id: open.id, ...back }, 'back')}>Save</button>
              <button className="dash-filter" onClick={() => setOpen(null)}>Cancel</button>
            </div>
            {back.how === 'bank' && (
              <div style={{ marginTop: 8 }}>
                {!open.candidates && <button className="dash-filter" onClick={() => showCandidates({ id: open.id }, 'back')}>Find the bank line</button>}
                {open.candidates && open.candidates.length === 0 && <div className="hint">No bank line for that exact amount yet. Wait for it to show, or choose another way.</div>}
                {open.candidates && open.candidates.map((c) => (
                  <label key={c.id} style={{ display: 'block', marginTop: 4 }}>
                    <input type="radio" name="bl" checked={String(back.bankExpenseId) === String(c.id)} onChange={() => setBack((b) => ({ ...b, bankExpenseId: c.id }))} /> {c.date} · {c.who} · {cad(c.gross)}</label>))}
                {open.candidates && open.candidates.length > 0 && <div className="hint" style={{ marginTop: 4 }}>That bank line comes out of the expenses, because the cost is already booked from the receipt and paying somebody back is not a second cost.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
