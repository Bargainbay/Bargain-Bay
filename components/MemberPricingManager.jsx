'use client';
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/constants';
import { toPercent, fromPercent, MEMBER_RATE_LABELS } from '../lib/member-rate-rules';

// One screen for what a reseller pays, and what the public pays. Every unit on sale is a row: type a
// public price and/or a member price right in the row and save it. Every number is previewed through
// the same function checkout uses, so the screen cannot disagree with what a member is charged.
// The four shop-wide rates sit underneath; they only decide units that have no typed member price.
const FIELDS = [
  { key: 'regularRate', unit: '%', help: 'Share of the retail (strike-through) price. 55 means a member pays 55% of retail.' },
  { key: 'clearanceRate', unit: '%', help: 'Share of the clearance price. 90 means 10% off the markdown.' },
  { key: 'costFloor', unit: '%', help: 'A member never pays less than cost times this. 110 means cost + 10%.' },
  { key: 'minProfit', unit: '$', help: 'Where the unit has the room, we keep at least this much. 0 turns it off.' }
];
const show = (key, v) => (key === 'minProfit' ? String(v) : String(toPercent(v)));
const parse = (key, text) => (text === '' ? null : key === 'minProfit' ? Number(text) : fromPercent(text));
const num = (t) => (t === '' || t == null ? null : Number(String(t).replace(/[$,\s]/g, '')));
const plain = (n) => (n == null ? '' : String(Math.round(n * 100) / 100));

export default function MemberPricingManager({ initial }) {
  const [saved, setSaved] = useState(initial.rates);
  const [text, setText] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, initial.rates[f.key])])));
  const [preview, setPreview] = useState(initial.preview);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState({}); // sku -> { member, pub } as typed text
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState('');
  const seq = useRef(0);

  const draft = Object.fromEntries(FIELDS.map((f) => [f.key, parse(f.key, text[f.key])]));
  const dirty = FIELDS.some((f) => draft[f.key] !== null && draft[f.key] !== saved[f.key]);

  async function post(body) {
    const r = await fetch('/api/admin/member-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  }

  // Re-run the preview as the rates, the search or the page change. Latest request wins.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { ok, d } = await post({ action: 'preview', rates: draft, q, page });
      if (id !== seq.current) return;
      if (ok) { setPreview(d.preview); setErr(''); if (d.preview.page !== page) setPage(d.preview.page); } else setErr(d.error || 'Could not preview.');
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q, page]);

  async function saveRates(action) {
    setBusy(true); setErr(''); setNotice('');
    const { ok, d } = await post({ action, rates: draft });
    setBusy(false);
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setSaved(d.rates);
    setText(Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, d.rates[f.key])])));
    setPreview(d.preview);
    setNotice(action === 'reset_rates' ? 'Back to the standard rates. Members see it within a minute.' : 'Saved. Members see the new prices within a minute.');
  }

  const setEdit = (sku, patch) => setEdits((e) => ({ ...e, [sku]: { ...e[sku], ...patch } }));
  const clearEdit = (sku) => setEdits((e) => { const n = { ...e }; delete n[sku]; return n; });

  // Save one row: only the prices that were actually changed go to the server.
  async function saveRow(r, extra = {}) {
    const ed = edits[r.sku] || {};
    const body = { action: 'set_prices', sku: r.sku, q, page, ...extra };
    if (!('member' in body) && ed.member !== undefined) {
      const m = num(ed.member);
      if (m !== null && Math.round(m * 100) !== Math.round(r.memberNow * 100)) body.member = m;
    }
    if (!('publicPrice' in body) && ed.pub !== undefined) {
      const p = num(ed.pub);
      if (p !== null && Math.round(p * 100) !== Math.round(r.public * 100)) body.publicPrice = p;
    }
    if (!('member' in body) && !('publicPrice' in body)) { clearEdit(r.sku); return; }
    setRowBusy(r.sku); setErr(''); setNotice('');
    const { ok, d } = await post(body);
    setRowBusy('');
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setPreview(d.preview);
    clearEdit(r.sku);
    setNotice(`${r.sku}: ${d.done?.length ? d.done.join(', ') : 'no change'}. Members and the public see it within a minute.`);
  }

  const s = preview?.summary;
  const warn = s && (s.belowCost > 0 || s.belowMinProfit > 0);
  const input = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, width: 110 };
  const cell = { padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8, width: 96 };
  const rows = preview?.rows || [];
  const first = rows.length ? (preview.page - 1) * preview.pageSize + 1 : 0;
  const last = rows.length ? first + rows.length - 1 : 0;

  const pager = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13.5 }}>
      <button className="btn" type="button" disabled={!preview || preview.page <= 1} onClick={() => setPage(preview.page - 1)}>‹ Previous</button>
      <span>Page <b>{preview?.page || 1}</b> of <b>{preview?.pages || 1}</b></span>
      <button className="btn" type="button" disabled={!preview || preview.page >= preview.pages} onClick={() => setPage(preview.page + 1)}>Next ›</button>
      <span style={{ color: 'var(--muted)' }}>{preview?.total ? `Showing ${first}–${last} of ${preview.total} units` : ''}</span>
    </div>
  );

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {notice && <div className="panel" style={{ color: '#0B6B3A', fontSize: 14 }}>{notice}</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Adjust member pricing</h2>
        {s && (
          <p style={{ fontSize: 14.5, margin: '0 0 8px' }}>
            Of <b>{s.units}</b> units on sale, members get a discount on <b>{s.discounted}</b> (averaging <b>{s.avgDiscountPct}%</b> off the public price).
            On <b>{s.atPublic}</b> they pay the public price because the floor leaves no room.
          </p>
        )}
        {warn && (
          <div className="error-box" style={{ marginBottom: 10 }}>
            {s.belowCost > 0 && <div><b>{s.belowCost}</b> unit{s.belowCost === 1 ? '' : 's'} would sell to members below cost. (Clearance markdowns you set below cost on purpose stay that way.)</div>}
            {s.belowMinProfit > 0 && <div><b>{s.belowMinProfit}</b> unit{s.belowMinProfit === 1 ? '' : 's'} would leave less than the dollar minimum clear.</div>}
          </div>
        )}
        <p className="hint" style={{ marginTop: 0 }}>
          Type a new <b>public</b> price and/or <b>member</b> price in a row and press <b>Save</b> (or Enter). A member never pays less than the floor or more than the public price.
          Changing a public price marks the unit down from its tracker price, so it shows on the Clearance page; <i>Back to tracker price</i> undoes that.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by SKU, brand, model or name" style={{ ...input, width: '100%', maxWidth: 380 }} />
          {pager}
        </div>
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Unit</th><th>Retail</th><th>Public price</th><th>Member price</th><th>We keep</th><th></th></tr></thead>
          <tbody>{rows.map((r) => {
            const ed = edits[r.sku] || {};
            const changed = ed.member !== undefined || ed.pub !== undefined;
            const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRow(r); } };
            return (
              <tr key={r.sku}>
                <td style={{ fontSize: 13 }}><b>{r.title}</b>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{r.sku}{r.onClearance ? ' · clearance' : ''}{r.override != null ? ' · typed member price' : ''}</div></td>
                <td>{r.retail ? money(r.retail) : '—'}</td>
                <td>
                  <div>$ <input style={cell} inputMode="decimal" value={ed.pub ?? plain(r.public)} onChange={(e) => setEdit(r.sku, { pub: e.target.value })} onKeyDown={onKey} aria-label={`Public price for ${r.sku}`} /></div>
                  {r.onClearance && <button type="button" className="btn" style={{ marginTop: 4, fontSize: 12, padding: '2px 8px' }} disabled={rowBusy === r.sku} onClick={() => { if (confirm(`Put ${r.sku} back to its tracker price of ${money(r.listPrice)}?`)) saveRow(r, { publicPrice: null }); }}>Back to tracker price ({money(r.listPrice)})</button>}
                </td>
                <td>
                  <div>$ <input style={cell} inputMode="decimal" value={ed.member ?? plain(r.memberNow)} onChange={(e) => setEdit(r.sku, { member: e.target.value })} onKeyDown={onKey} aria-label={`Member price for ${r.sku}`} /></div>
                  {r.memberNext !== r.memberNow && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{money(r.memberNext)} with the new rates</div>}
                  {r.override != null && <button type="button" className="btn" style={{ marginTop: 4, fontSize: 12, padding: '2px 8px' }} disabled={rowBusy === r.sku} onClick={() => saveRow(r, { member: null })}>Use the rates</button>}
                </td>
                <td style={{ color: r.marginNext != null && r.marginNext < 0 ? '#b00020' : undefined }}>{r.marginNext == null ? 'no cost' : money(r.marginNext)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary" type="button" disabled={!changed || rowBusy === r.sku} onClick={() => saveRow(r)}>{rowBusy === r.sku ? 'Saving…' : 'Save'}</button>
                  {changed && <button className="btn" type="button" style={{ marginLeft: 6 }} onClick={() => clearEdit(r.sku)}>Undo</button>}
                </td>
              </tr>);
          })}
            {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No units match.</td></tr>}
          </tbody>
        </table></div>
        <div style={{ marginTop: 10 }}>{pager}</div>
      </div>

      <details className="panel">
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>Shop-wide rates (what every unit without a typed member price follows)</summary>
        <p className="hint">These apply to every approved member, to the whole shop, and at checkout. A member never pays less than the floor and never more than the public price — those two rules cannot be switched off. Changing them re-prices the table above as a preview before you save.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 14 }}>
          {FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'block' }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{MEMBER_RATE_LABELS[f.key]}</span>
              <div style={{ margin: '6px 0 4px' }}>
                {f.unit === '$' && <span>$ </span>}
                <input style={input} inputMode="decimal" value={text[f.key]} onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))} />
                {f.unit === '%' && <span> %</span>}
                {draft[f.key] !== null && draft[f.key] !== saved[f.key] && <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--muted)' }}>was {show(f.key, saved[f.key])}{f.unit}</span>}
              </div>
              <div className="hint">{f.help}</div>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || !dirty || !!err} onClick={() => saveRates('save_rates')}>{busy ? 'Saving…' : 'Save member rates'}</button>
          <button className="btn" disabled={busy || !dirty} onClick={() => setText(Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, saved[f.key])])))}>Undo changes</button>
          <button className="btn" disabled={busy} onClick={() => { if (confirm('Put all four rates back to the standard 55% / 90% / cost + 10% / $200?')) saveRates('reset_rates'); }}>Reset to standard</button>
        </div>
      </details>
    </div>
  );
}
