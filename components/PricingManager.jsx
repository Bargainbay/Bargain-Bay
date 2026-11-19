'use client';
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/constants';
import { toPercent, fromPercent, MEMBER_RATE_LABELS } from '../lib/member-rate-rules';
import { resolveTyped } from '../lib/price-math';

// The Pricing screen. Every unit on sale is a row: what it cost, what the public pays, what a member
// pays, and what we keep on each. Change a price in the row (a number, "+5%" or "-25"), or change many
// at once with "Change prices in bulk" above the table. A public price change is written to the tracker
// as well as the site; member prices exist on the site only. Every figure comes from the same function
// checkout uses, so this screen cannot disagree with what a customer is charged.
const FIELDS = [
  { key: 'regularRate', unit: '%', help: 'Share of the retail (strike-through) price. 55 means a member pays 55% of retail.' },
  { key: 'clearanceRate', unit: '%', help: 'Share of the clearance price. 90 means 10% off the markdown.' },
  { key: 'costFloor', unit: '%', help: 'A member never pays less than cost times this. 110 means cost + 10%.' },
  { key: 'minProfit', unit: '$', help: 'Where the unit has the room, we keep at least this much. 0 turns it off.' }
];
const show = (key, v) => (key === 'minProfit' ? String(v) : String(toPercent(v)));
const parse = (key, text) => (text === '' ? null : key === 'minProfit' ? Number(text) : fromPercent(text));
const plain = (n) => (n == null ? '' : String(Math.round(n * 100) / 100));
const RED = '#b00020';
// What a person says: "raise 5%", "lower $50", "cost plus 30%", "70% of retail".
const HOW = [
  { id: 'raise', label: 'Raise by' },
  { id: 'lower', label: 'Lower by' },
  { id: 'markup', label: 'Set to cost plus' },
  { id: 'retail', label: 'Set to % of retail' }
];

// what share of retail a price is, as a number like 65 or 62.5 (null with no retail)
const pctOfRetail = (price, retail) => (retail > 0 && price > 0 ? Math.round((price / retail) * 1000) / 10 : null);
const pctBox = { padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 8, width: 62 };

// profit and margin for one price against a cost
function profitOf(price, cost) {
  if (!cost) return null;
  const p = Math.round((price - cost) * 100) / 100;
  return { p, pct: price > 0 ? Math.round((p / price) * 1000) / 10 : 0 };
}

export default function PricingManager({ initial }) {
  const [saved, setSaved] = useState(initial.rates);
  const [text, setText] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, initial.rates[f.key])])));
  const [preview, setPreview] = useState(initial.preview);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [sort, setSort] = useState('title');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [edits, setEdits] = useState({}); // sku -> { member, pub } as typed text
  const [picked, setPicked] = useState({}); // sku -> true
  const [bulk, setBulk] = useState({ scope: 'auto', target: 'both', how: 'raise', unit: 'pct', amount: '', round: false });
  const [bulkPreview, setBulkPreview] = useState(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState('');
  const seq = useRef(0);

  const draft = Object.fromEntries(FIELDS.map((f) => [f.key, parse(f.key, text[f.key])]));
  const dirty = FIELDS.some((f) => draft[f.key] !== null && draft[f.key] !== saved[f.key]);
  const view = { q, filter, sort, page, category, condition, pageSize };

  async function post(body) {
    const r = await fetch('/api/admin/member-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  }

  // Re-run the preview as the rates, search, filter, sort or page change. Latest request wins.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { ok, d } = await post({ action: 'preview', rates: draft, ...view });
      if (id !== seq.current) return;
      if (ok) { setPreview(d.preview); setErr(''); if (d.preview.page !== page) setPage(d.preview.page); } else setErr(d.error || 'Could not load prices.');
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q, filter, sort, page, category, condition, pageSize]);

  async function saveRates(action) {
    setBusy(true); setErr(''); setNotice('');
    const { ok, d } = await post({ action, rates: draft, ...view });
    setBusy(false);
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setSaved(d.rates);
    setText(Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, d.rates[f.key])])));
    setPreview(d.preview);
    setNotice(action === 'reset_rates' ? 'Back to the standard rates. Members see it within a minute.' : 'Saved. Members see the new prices within a minute.');
  }

  const setEdit = (sku, patch) => setEdits((e) => ({ ...e, [sku]: { ...e[sku], ...patch } }));
  // Typing the percentage itself: 65 means 65% of retail. It fills the price box, so Save works as usual.
  const setPct = (r, kind, text) => {
    const clean = text.replace(/[^0-9.]/g, '');
    const n = Number(clean);
    const patch = { [`${kind}Pct`]: clean };
    if (clean !== '' && Number.isFinite(n) && n > 0 && r.retail > 0) patch[kind] = String(Math.round(r.retail * n) / 100);
    setEdit(r.sku, patch);
  };
  const clearEdit = (sku) => setEdits((e) => { const n = { ...e }; delete n[sku]; return n; });

  // Save one row. Typed text is resolved against what the row shows now ("+5%" etc.).
  async function saveRow(r, extra = {}) {
    const ed = edits[r.sku] || {};
    const body = { action: 'set_prices', sku: r.sku, ...view, ...extra };
    if (!('member' in body) && ed.member !== undefined) {
      const m = resolveTyped(ed.member, r.memberNow);
      if (m === null) { setErr(`Member price for ${r.sku}: type a price, or +5% / -10% / +50 / -25.`); return; }
      if (Math.round(m * 100) !== Math.round(r.memberNow * 100)) body.member = m;
    }
    if (!('publicPrice' in body) && ed.pub !== undefined) {
      const p = resolveTyped(ed.pub, r.public);
      if (p === null) { setErr(`Public price for ${r.sku}: type a price, or +5% / -10% / +50 / -25.`); return; }
      if (Math.round(p * 100) !== Math.round(r.public * 100)) body.publicPrice = p;
    }
    if (!('member' in body) && !('publicPrice' in body)) { clearEdit(r.sku); return; }
    setRowBusy(r.sku); setErr(''); setNotice('');
    const { ok, d } = await post(body);
    setRowBusy('');
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setPreview(d.preview);
    clearEdit(r.sku);
    setNotice(`${r.sku}: ${d.done?.length ? d.done.join(', ') : 'no change'}.${'publicPrice' in body ? ' The tracker and the website are updated.' : ''}`);
  }

  const rows = preview?.rows || [];
  const first = rows.length ? (preview.page - 1) * preview.pageSize + 1 : 0;
  const last = rows.length ? first + rows.length - 1 : 0;
  const pickedSkus = Object.keys(picked).filter((k) => picked[k]);
  const allOnPage = rows.length > 0 && rows.every((r) => picked[r.sku]);
  const togglePage = () => setPicked((p) => { const n = { ...p }; rows.forEach((r) => { if (allOnPage) delete n[r.sku]; else n[r.sku] = true; }); return n; });

  // ── bulk ──
  const useTicked = pickedSkus.length > 0 && bulk.scope !== 'matching';
  const amt = Number(bulk.amount);
  const bulkMode = bulk.how === 'markup' ? 'markup' : bulk.how === 'retail' ? 'retail' : bulk.unit; // pct | usd | markup | retail
  const bulkAmount = bulk.how === 'lower' ? -Math.abs(amt) : Math.abs(amt);
  const bulkBody = (dryRun) => ({
    action: 'bulk', dryRun, ...view, target: bulk.target, mode: bulkMode, amount: bulkAmount, round: bulk.round ? 'dollar' : 'cents',
    ...(useTicked ? { skus: pickedSkus } : {})
  });
  const bulkReady = bulk.amount !== '' && Number.isFinite(amt) && amt !== 0;
  const showsUnit = bulk.how === 'raise' || bulk.how === 'lower';
  const unitChar = showsUnit ? (bulk.unit === 'pct' ? '%' : '$') : '%';
  const scopeText = useTicked ? `the ${pickedSkus.length} ticked unit${pickedSkus.length === 1 ? '' : 's'}` : `all ${preview?.total ?? 0} units shown below`;
  async function bulkLook() {
    setBusy(true); setErr(''); setNotice(''); setBulkPreview(null);
    const { ok, d } = await post(bulkBody(true));
    setBusy(false);
    if (!ok) { setErr(d.error || 'Could not work that out.'); return; }
    setBulkPreview(d);
  }
  async function bulkApply() {
    setBusy(true); setErr(''); setNotice('');
    const { ok, d } = await post(bulkBody(false));
    setBusy(false);
    if (!ok) { setErr(d.error || 'Could not apply.'); return; }
    setPreview(d.preview); setBulkPreview(null); setPicked({});
    setNotice(`Changed ${d.changed} unit${d.changed === 1 ? '' : 's'}. The tracker and the website are updated.${d.failedCount ? ` ${d.failedCount} could not be changed: ${d.failed.map((f) => `${f.sku} (${f.error})`).join('; ')}` : ''}`);
  }

  const input = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, width: 110 };
  const cell = { padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8, width: 92 };
  const s = preview?.summary;

  const pager = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13.5 }}>
      <button className="btn" type="button" disabled={!preview || preview.page <= 1} onClick={() => setPage(preview.page - 1)}>‹ Previous</button>
      <span>Page <b>{preview?.page || 1}</b> of <b>{preview?.pages || 1}</b></span>
      <button className="btn" type="button" disabled={!preview || preview.page >= preview.pages} onClick={() => setPage(preview.page + 1)}>Next ›</button>
      <span style={{ color: 'var(--muted)' }}>{preview?.total ? `Showing ${first}–${last} of ${preview.total} units` : ''}</span>
    </div>
  );

  // profit cell, on one line: dollars, then margin; red when it is a loss
  const profitCell = (pr) => (pr
    ? <span style={{ color: pr.p < 0 ? RED : undefined, fontWeight: pr.p < 0 ? 700 : 400, whiteSpace: 'nowrap' }}>{pr.p < 0 ? '−' : ''}{money(Math.abs(pr.p))} <span style={{ fontSize: 11.5, color: pr.p < 0 ? RED : 'var(--muted)', fontWeight: 400 }}>{pr.pct}%</span></span>
    : <span style={{ color: 'var(--muted)', fontSize: 12 }}>no cost</span>);

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {notice && <div className="panel" style={{ color: '#0B6B3A', fontSize: 14 }}>{notice}</div>}

      <div className="panel">
        {s && (
          <p style={{ fontSize: 14.5, margin: '0 0 6px' }}>
            <b>{s.units}</b> units on sale. Members get a discount on <b>{s.discounted}</b> (about <b>{s.avgDiscountPct}%</b> off the public price).
            {(s.belowCost > 0 || filter === 'below') && <> <button type="button" className="btn" style={{ marginLeft: 6, fontSize: 12.5, padding: '2px 10px' }} onClick={() => { setFilter(filter === 'below' ? '' : 'below'); setPage(1); }}>{filter === 'below' ? 'Show all units' : `Show the ${s.belowCost} priced below cost`}</button></>}
          </p>
        )}
        <p className="hint" style={{ marginTop: 0 }}>
          Change a price right in the row: type a new price, or <b>+7%</b> / <b>-25</b> to move it from what it shows now, then <b>Save</b>. Every price also shows what <b>percent of retail</b> it is: type a new percentage (say 65) to set the price from it. To change a whole group, use the box above the table.
          A <b>public</b> price change is written to the <b>tracker</b> and the website. <b>Member</b> prices exist on the website only (the tracker has no member column).
          A member never pays more than the public price. <i>Back to tracker price</i> undoes a public change.
        </p>

        <div style={{ margin: '0 0 14px', border: '2px solid var(--line)', borderRadius: 12, padding: '12px 14px', background: 'var(--bg, #fafafa)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Change many prices at once</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 13 }}>Which price<br />
              <select style={{ ...input, width: 170 }} value={bulk.target} onChange={(e) => { setBulk({ ...bulk, target: e.target.value }); setBulkPreview(null); }}>
                <option value="both">Public and member</option>
                <option value="public">Public only</option>
                <option value="member">Member only</option>
              </select></label>
            <label style={{ fontSize: 13 }}>What to do<br />
              <select style={{ ...input, width: 170 }} value={bulk.how} onChange={(e) => { setBulk({ ...bulk, how: e.target.value }); setBulkPreview(null); }}>
                {HOW.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}>Amount<br />
              <span><input style={{ ...input, width: 90 }} inputMode="decimal" placeholder={bulk.how === 'retail' ? '70' : '5'} value={bulk.amount} onChange={(e) => { setBulk({ ...bulk, amount: e.target.value.replace(/[^0-9.]/g, '') }); setBulkPreview(null); }} />
                {showsUnit
                  ? <select style={{ ...input, width: 110, marginLeft: 6 }} value={bulk.unit} onChange={(e) => { setBulk({ ...bulk, unit: e.target.value }); setBulkPreview(null); }} aria-label="Percent or dollars"><option value="pct">percent %</option><option value="usd">dollars $</option></select>
                  : <b style={{ marginLeft: 6 }}>%</b>}
              </span></label>
            <label style={{ fontSize: 13, paddingBottom: 8 }}><input type="checkbox" checked={bulk.round} onChange={(e) => { setBulk({ ...bulk, round: e.target.checked }); setBulkPreview(null); }} /> Round to whole dollars</label>
            <button className="btn primary" type="button" disabled={busy || !bulkReady} onClick={bulkLook}>See what changes</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            This will change <b>{scopeText}</b> (the search and filters below decide which). Tick units in the table to change only those.
            {pickedSkus.length > 0 && <> <button type="button" className="btn" style={{ fontSize: 12, padding: '2px 8px', marginLeft: 6 }} onClick={() => { setPicked({}); setBulkPreview(null); }}>Untick all</button></>}
          </div>
          {bulkPreview && (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              <div><b>{bulkPreview.willChange}</b> of {bulkPreview.considered} units would change.{bulkPreview.belowCost > 0 && <> <span style={{ color: RED }}>{bulkPreview.belowCost} would end up priced below cost.</span></>}</div>
              {bulkPreview.sample.length > 0 && (
                <div className="table-wrap" style={{ margin: '8px 0' }}><table className="admin"><thead><tr><th>Unit</th><th>Cost</th><th>Public</th><th>Member</th></tr></thead><tbody>
                  {bulkPreview.sample.map((x) => (
                    <tr key={x.sku}><td style={{ fontSize: 13 }}>{x.title}<div style={{ color: 'var(--muted)', fontSize: 12 }}>{x.sku}</div></td>
                      <td>{x.cost ? money(x.cost) : '—'}</td>
                      <td>{x.movesPublic ? <>{money(x.oldPublic)} → <b>{money(x.newPublic)}</b></> : money(x.oldPublic)}</td>
                      <td>{x.movesMember ? <>{money(x.oldMember)} → <b>{money(x.newMember)}</b></> : money(x.oldMember)}</td></tr>))}
                </tbody></table></div>)}
              {bulkPreview.willChange > bulkPreview.sample.length && <div className="hint">Showing the first {bulkPreview.sample.length}.</div>}
              <button className="btn primary" type="button" disabled={busy || bulkPreview.willChange === 0} onClick={bulkApply}>{busy ? 'Applying…' : `Apply to ${bulkPreview.willChange} unit${bulkPreview.willChange === 1 ? '' : 's'}`}</button>
              <button className="btn" type="button" style={{ marginLeft: 8 }} onClick={() => setBulkPreview(null)}>Cancel</button>
            </div>)}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search SKU, brand, model, name or condition" style={{ ...input, width: '100%', maxWidth: 360 }} />
          <select style={{ ...input, width: 200 }} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
            <option value="">All categories</option>
            {(preview?.categories || []).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
          <select style={{ ...input, width: 200 }} value={condition} onChange={(e) => { setCondition(e.target.value); setPage(1); }} aria-label="Condition">
            <option value="">All conditions</option>
            {(preview?.conditions || []).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
          <select style={{ ...input, width: 190 }} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} aria-label="Filter">
            <option value="">All units</option>
            <option value="below">Priced below cost</option>
          </select>
          <select style={{ ...input, width: 210 }} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort">
            <option value="title">Sort: name</option>
            <option value="profit_low">Sort: lowest profit first</option>
            <option value="profit_high">Sort: highest profit first</option>
            <option value="member_profit_low">Sort: lowest member profit</option>
            <option value="price_high">Sort: highest price</option>
            <option value="price_low">Sort: lowest price</option>
          </select>
          <select style={{ ...input, width: 130 }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Rows per page">
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
          {(category || condition || filter || q) && <button type="button" className="btn" onClick={() => { setCategory(''); setCondition(''); setFilter(''); setQ(''); setPage(1); }}>Clear filters</button>}
          {pager}
        </div>

        <style>{`
          .pt td, .pt th { padding: 3px 7px !important; font-size: 13px; line-height: 1.25; vertical-align: middle; }
          .pt th { font-size: 12px; white-space: nowrap; }
          .pt .pt-unit { width: 190px; max-width: 190px; }
          .pt .pt-unit b, .pt .pt-sub { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .pt .pt-sub { font-size: 11.5px; }
          .pt .pt-price { white-space: nowrap; }
          .pt .pt-price input { padding: 3px 5px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; }
          .pt .pt-tiny { border: 1px solid var(--line); background: transparent; border-radius: 6px; font-size: 12px; padding: 1px 5px; cursor: pointer; }
        `}</style>
        <div className="table-wrap"><table className="admin pt">
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Tick every unit on this page" /></th>
            <th>Unit</th><th>Cost</th><th>Retail</th><th>Public price · % of retail</th><th>Public profit</th><th>Member price · % of retail</th><th>Member profit</th><th></th></tr></thead>
          <tbody>{rows.map((r) => {
            const ed = edits[r.sku] || {};
            const changed = ed.member !== undefined || ed.pub !== undefined;
            const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRow(r); } };
            const loss = r.cost > 0 && (r.public + 0.005 < r.cost || r.memberNext + 0.005 < r.cost);
            const pubShown = resolveTyped(ed.pub, r.public);
            const memShown = resolveTyped(ed.member, r.memberNow);
            const relPub = ed.pub !== undefined && /^[+-]/.test(String(ed.pub).trim()) && pubShown != null;
            const relMem = ed.member !== undefined && /^[+-]/.test(String(ed.member).trim()) && memShown != null;
            const badPub = ed.pub !== undefined && String(ed.pub).trim() !== '' && pubShown == null;
            const badMem = ed.member !== undefined && String(ed.member).trim() !== '' && memShown == null;
            const sub = `${r.sku}${r.condition ? ` · ${r.condition}` : ''}${r.onClearance ? ' · markdown' : ''}${r.override != null ? ' · typed member price' : ''}${loss ? ' · below cost' : ''}`;
            const trackerNow = money(r.trackerPrice ?? r.listPrice);
            return (
              <tr key={r.sku} style={loss ? { background: '#fdecea' } : undefined}>
                <td><input type="checkbox" checked={!!picked[r.sku]} onChange={(e) => setPicked((p) => ({ ...p, [r.sku]: e.target.checked }))} aria-label={`Tick ${r.sku}`} /></td>
                <td className="pt-unit" style={{ color: loss ? RED : undefined }} title={`${r.title} — ${sub}`}><b>{r.title}</b>
                  <span className="pt-sub" style={{ color: loss ? RED : 'var(--muted)' }}>{sub}</span></td>
                <td>{r.cost ? money(r.cost) : <span style={{ color: 'var(--muted)' }}>none</span>}</td>
                <td>{r.retail ? money(r.retail) : '—'}</td>
                <td className="pt-price">
                  $<input style={{ ...cell, width: 84, borderColor: badPub ? RED : undefined }} inputMode="decimal" value={ed.pub ?? plain(r.public)} onChange={(e) => setEdit(r.sku, { pub: e.target.value, pubPct: undefined })} onKeyDown={onKey} aria-label={`Public price for ${r.sku}`} title={badPub ? 'Type a price, or +5% / -5%' : undefined} />
                  {r.retail > 0 && <> <input style={{ ...pctBox, width: 54, borderColor: badPub ? RED : undefined }} inputMode="decimal" value={ed.pubPct ?? String(pctOfRetail(pubShown ?? r.public, r.retail) ?? '')} onChange={(e) => setPct(r, 'pub', e.target.value)} onKeyDown={onKey} aria-label={`Public price as a percentage of retail for ${r.sku}`} />%</>}
                  {relPub && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}> → {money(pubShown)}</span>}
                  {(r.onClearance || r.listOverride) && <> <button type="button" className="pt-tiny" title={`Back to tracker price (${trackerNow})`} disabled={rowBusy === r.sku} onClick={() => { if (confirm(`Put ${r.sku} back to its tracker price of ${trackerNow}?`)) saveRow(r, { publicPrice: null }); }}>↺ {trackerNow}</button></>}
                </td>
                <td>{profitCell(profitOf(ed.pub !== undefined && pubShown ? pubShown : r.public, r.cost))}</td>
                <td className="pt-price">
                  $<input style={{ ...cell, width: 84, borderColor: badMem ? RED : undefined }} inputMode="decimal" value={ed.member ?? plain(r.memberNow)} onChange={(e) => setEdit(r.sku, { member: e.target.value, memberPct: undefined })} onKeyDown={onKey} aria-label={`Member price for ${r.sku}`} title={badMem ? 'Type a price, or +5% / -5%' : undefined} />
                  {r.retail > 0 && <> <input style={{ ...pctBox, width: 54, borderColor: badMem ? RED : undefined }} inputMode="decimal" value={ed.memberPct ?? String(pctOfRetail(memShown ?? r.memberNow, r.retail) ?? '')} onChange={(e) => setPct(r, 'member', e.target.value)} onKeyDown={onKey} aria-label={`Member price as a percentage of retail for ${r.sku}`} />%</>}
                  {relMem && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}> → {money(memShown)}</span>}
                  {r.memberNext !== r.memberNow && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}> (new rates {money(r.memberNext)})</span>}
                  {r.override != null && <> <button type="button" className="pt-tiny" title="Use the shop-wide rates for this unit again" disabled={rowBusy === r.sku} onClick={() => saveRow(r, { member: null })}>↺ rates</button></>}
                </td>
                <td>{profitCell(profitOf(ed.member !== undefined && memShown ? memShown : r.memberNext, r.cost))}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary" type="button" style={{ padding: '3px 10px', fontSize: 12.5 }} disabled={!changed || rowBusy === r.sku} onClick={() => saveRow(r)}>{rowBusy === r.sku ? '…' : 'Save'}</button>
                  {changed && <button className="btn" type="button" style={{ marginLeft: 4, padding: '3px 8px', fontSize: 12.5 }} onClick={() => clearEdit(r.sku)}>Undo</button>}
                </td>
              </tr>);
          })}
            {rows.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--muted)' }}>No units match.</td></tr>}
          </tbody>
        </table></div>
        <div style={{ marginTop: 10 }}>{pager}</div>
      </div>

      <details className="panel">
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>Shop-wide member rates (what every unit without a typed member price follows)</summary>
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
