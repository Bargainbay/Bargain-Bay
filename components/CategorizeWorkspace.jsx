'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { money } from '../lib/constants';

// Categorise the bank feed at scale. Two ways of working, because a thousand
// lines are a few dozen payees:
//   By payee          every "Home Depot" at once, one decision each
//   Each transaction  the full list: who, memo, account, amount; pick many, apply once
// A line leaves "To review" the moment a person categorises it (or accepts a
// suggestion), so the queue is a to-do list that visibly shrinks.
const STATUSES = [
  { key: 'review', label: 'To review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'rules', label: 'Sorted by a rule' },
  { key: 'all', label: 'Everything' }
];
const TAX = [
  { key: '', label: "Leave the HST as it is" },
  { key: 'hst', label: 'HST is included (13%)' },
  { key: 'none', label: 'No HST to claim' },
  { key: 'review', label: 'Decide the HST later' }
];
const inp = { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', fontSize: 13 };
const muted = { fontSize: 12, color: 'var(--muted)' };
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '');

async function api(path, opts) {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'That failed.');
  return d;
}
const post = (body) => api('/api/admin/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function CategorizeWorkspace({ categories = [] }) {
  const [meta, setMeta] = useState({ stats: null, accounts: [] });
  const [mode, setMode] = useState('payees');
  const [f, setF] = useState({ status: 'review', q: '', from: '', to: '', account: '', category: '', min: '', max: '', sort: 'date' });
  const [data, setData] = useState({ rows: [], groups: [], total: 0, gross: 0, capped: false });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState(null); // { text, undo }
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [bulk, setBulk] = useState({ category: '', taxMode: '', makeRule: false });
  const [offset, setOffset] = useState(0);
  const last = useRef(null);
  const reqId = useRef(0);

  const catList = useMemo(() => {
    const extra = new Set();
    for (const r of data.rows) if (r.category && !categories.includes(r.category)) extra.add(r.category);
    for (const g of data.groups) if (g.current && !categories.includes(g.current)) extra.add(g.current);
    return [...categories, ...extra];
  }, [categories, data]);

  const qs = useCallback((extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v != null) p.set(k, v);
    return p.toString();
  }, [f]);

  const loadMeta = useCallback(async () => {
    try { const d = await api('/api/admin/categorize?view=meta'); setMeta({ stats: d.stats, accounts: d.accounts }); } catch { /* shown on the next load */ }
  }, []);

  const load = useCallback(async (more = false) => {
    const id = ++reqId.current;
    setLoading(true); setErr('');
    try {
      if (mode === 'payees') {
        const d = await api(`/api/admin/categorize?${qs({ view: 'groups' })}`);
        if (id !== reqId.current) return;
        setData({ rows: [], groups: d.groups, total: d.lines, gross: d.groups.reduce((a, g) => a + g.total, 0), capped: d.capped });
      } else {
        const off = more ? offset + 100 : 0;
        const d = await api(`/api/admin/categorize?${qs({ view: 'rows', offset: off, limit: 100 })}`);
        if (id !== reqId.current) return;
        setOffset(off);
        setData((prev) => ({ rows: more ? [...prev.rows, ...d.rows] : d.rows, groups: [], total: d.total, gross: d.gross, capped: false }));
      }
    } catch (e) { if (id === reqId.current) setErr(e.message); } finally { if (id === reqId.current) setLoading(false); }
  }, [mode, qs, offset]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  // Reload when the view or any filter changes (search is debounced).
  useEffect(() => {
    setSel(new Set()); last.current = null;
    const t = setTimeout(() => load(false), f.q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, f]);

  const setFilter = (patch) => setF((x) => ({ ...x, ...patch }));
  const stats = meta.stats;

  // ---- applying ------------------------------------------------------------
  async function apply({ ids, category, taxMode = '', makeRule = false, label }) {
    if (!ids.length || !category) return;
    setBusy(true); setErr('');
    try {
      const d = await post({ action: 'categorize', ids, category, taxMode: taxMode || undefined, makeRule });
      setNote({
        text: `${d.updated} categorised as ${category}${label ? ` (${label})` : ''}${d.rules.length ? ` · remembered “${d.rules.join('”, “')}”` : ''}.`,
        undo: d.before
      });
      setSel(new Set());
      await Promise.all([load(false), loadMeta()]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function undo() {
    if (!note?.undo) return;
    setBusy(true); setErr('');
    try {
      const d = await post({ action: 'restore', rows: note.undo });
      setNote({ text: `Undone — ${d.updated} put back as they were.`, undo: null });
      await Promise.all([load(false), loadMeta()]);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function reviewAgain(ids) {
    setBusy(true); setErr('');
    try { await post({ action: 'review_again', ids }); await Promise.all([load(false), loadMeta()]); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function annotate(ids, patch) {
    setBusy(true); setErr('');
    try { await post({ action: 'annotate', ids, ...patch }); await load(false); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // ---- selection (lines view) ----------------------------------------------
  function toggle(row, index, shift) {
    setSel((cur) => {
      const next = new Set(cur);
      if (shift && last.current != null) {
        const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)];
        const on = !cur.has(row.id);
        for (let i = a; i <= b; i++) { if (on) next.add(data.rows[i].id); else next.delete(data.rows[i].id); }
      } else if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
      return next;
    });
    last.current = index;
  }
  const pageAll = data.rows.length > 0 && data.rows.every((r) => sel.has(r.id));
  const selRows = data.rows.filter((r) => sel.has(r.id));
  const selTotal = selRows.reduce((a, r) => a + r.gross, 0);
  async function selectEverything() {
    try { const d = await api(`/api/admin/categorize?${qs({ view: 'ids' })}`); setSel(new Set(d.ids)); setNote({ text: `Selected all ${d.ids.length}${d.capped ? ' (the first 5,000)' : ''} matching lines.`, undo: null }); }
    catch (e) { setErr(e.message); }
  }
  async function acceptSuggestions() {
    const by = new Map();
    for (const r of selRows) if (r.suggest) by.set(r.suggest, [...(by.get(r.suggest) || []), r.id]);
    if (!by.size) { setErr('None of the selected lines has a suggestion yet.'); return; }
    for (const [category, ids] of by) await apply({ ids, category });
  }

  const empty = !loading && (mode === 'payees' ? data.groups.length === 0 : data.rows.length === 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 6px' }}>
        <h1 style={{ margin: 0 }}>Categorize transactions</h1>
        <a href="/admin/financial" className="hint">← Financial health</a>
      </div>
      {stats && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div><b style={{ fontSize: 22 }}>{stats.toReview}</b> <span style={muted}>to review · {money(stats.toReviewGross)}</span></div>
            <div style={muted}>{stats.reviewed} reviewed of {stats.total}</div>
          </div>
          <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${stats.total ? Math.round((stats.reviewed / stats.total) * 100) : 0}%`, background: 'var(--accent, #2f9e6f)' }} />
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            Work the <b>By payee</b> list top to bottom: pick a category for a payee and every line from them is done at once.
            Use <b>Each transaction</b> when you need to see who it went to, the memo and the account before deciding.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {STATUSES.map((s) => (
          <button key={s.key} className={`dash-filter${f.status === s.key ? ' active' : ''}`} onClick={() => setFilter({ status: s.key })}>
            {s.label}{s.key === 'review' && stats ? ` (${stats.toReview})` : ''}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className={`dash-filter${mode === 'payees' ? ' active' : ''}`} onClick={() => setMode('payees')}>By payee</button>
        <button className={`dash-filter${mode === 'lines' ? ' active' : ''}`} onClick={() => setMode('lines')}>Each transaction</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input value={f.q} onChange={(e) => setFilter({ q: e.target.value })} placeholder="Search payee, memo, note, amount…" style={{ ...inp, minWidth: 240 }} />
        <input type="date" value={f.from} onChange={(e) => setFilter({ from: e.target.value })} style={inp} title="From" />
        <input type="date" value={f.to} onChange={(e) => setFilter({ to: e.target.value })} style={inp} title="To" />
        {meta.accounts.length > 1 && (
          <select value={f.account} onChange={(e) => setFilter({ account: e.target.value })} style={inp}>
            <option value="">All accounts</option>
            {meta.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <select value={f.category} onChange={(e) => setFilter({ category: e.target.value })} style={inp}>
          <option value="">Any category</option>
          <option value="__none">No category</option>
          {catList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min="0" placeholder="Min $" value={f.min} onChange={(e) => setFilter({ min: e.target.value })} style={{ ...inp, width: 80 }} />
        <input type="number" min="0" placeholder="Max $" value={f.max} onChange={(e) => setFilter({ max: e.target.value })} style={{ ...inp, width: 80 }} />
        {mode === 'lines' && (
          <select value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })} style={inp}>
            <option value="date">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount">Largest first</option>
            <option value="payee">By payee</option>
          </select>
        )}
      </div>

      {note && (
        <div className="notice-box" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{note.text}</span>
          {note.undo && <button className="dash-filter" disabled={busy} onClick={undo}>Undo</button>}
          <button className="dash-filter" onClick={() => setNote(null)}>Dismiss</button>
        </div>
      )}
      {err && <div className="error-box" style={{ marginBottom: 10 }}>{err}</div>}
      {loading && <p className="hint">Loading…</p>}
      {empty && (
        <div className="panel">
          {f.status === 'review' && !f.q ? 'Nothing left to review. 🎉' : 'Nothing matches those filters.'}
        </div>
      )}

      {mode === 'payees' && data.groups.length > 0 && (
        <div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            {data.groups.length} payee{data.groups.length === 1 ? '' : 's'} · {data.total} line{data.total === 1 ? '' : 's'} · {money(data.gross)}
            {data.capped && ' · showing the newest 5,000 lines'}
          </p>
          {data.groups.map((g) => (
            <GroupCard key={g.key} g={g} catList={catList} busy={busy} qs={qs}
              onApply={(o) => apply({ ids: g.ids, ...o, label: g.label })} onAnnotate={annotate} />
          ))}
        </div>
      )}

      {mode === 'lines' && data.rows.length > 0 && (
        <div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            {data.total} line{data.total === 1 ? '' : 's'} · {money(data.gross)}
            {pageAll && data.total > data.rows.length && sel.size < data.total && (
              <> · <button className="dash-filter" onClick={selectEverything}>Select all {data.total}</button></>
            )}
          </p>
          <div className="table-wrap">
            <table className="admin">
              <thead>
                <tr>
                  <th style={{ width: 28 }}><input type="checkbox" checked={pageAll} onChange={() => setSel(pageAll ? new Set() : new Set(data.rows.map((r) => r.id)))} aria-label="Select all on this page" /></th>
                  <th>Date</th><th>Who / what</th><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th><th>Category</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <LineRow key={r.id} r={r} i={i} checked={sel.has(r.id)} onToggle={toggle} catList={catList} busy={busy}
                    onCategory={(category) => apply({ ids: [r.id], category })} onAnnotate={annotate} onAgain={() => reviewAgain([r.id])} />
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length < data.total && (
            <p style={{ margin: '10px 0 0' }}><button className="dash-filter" disabled={loading} onClick={() => load(true)}>Show 100 more ({data.total - data.rows.length} left)</button></p>
          )}
        </div>
      )}

      {sel.size > 0 && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: 14, padding: '10px 12px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 -4px 14px rgba(0,0,0,.18)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', zIndex: 5 }}>
          <b>{sel.size} selected</b>
          {selRows.length === sel.size && <span style={muted}>{money(selTotal)}</span>}
          <select value={bulk.category} onChange={(e) => setBulk({ ...bulk, category: e.target.value })} style={inp}>
            <option value="">Category…</option>
            {catList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={bulk.taxMode} onChange={(e) => setBulk({ ...bulk, taxMode: e.target.value })} style={inp}>
            {TAX.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label style={{ fontSize: 13 }} title="Saves a rule so future lines from the same payees are sorted the same way">
            <input type="checkbox" checked={bulk.makeRule} onChange={(e) => setBulk({ ...bulk, makeRule: e.target.checked })} /> Remember these payees
          </label>
          <button className="dash-filter active" disabled={busy || !bulk.category} onClick={() => apply({ ids: [...sel], ...bulk })}>{busy ? 'Saving…' : `Apply to ${sel.size}`}</button>
          <button className="dash-filter" disabled={busy} onClick={acceptSuggestions} title="Use each line's suggested category">Accept suggestions</button>
          <button className="dash-filter" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
    </div>
  );
}

// One payee, every line from them.
function GroupCard({ g, catList, busy, qs, onApply, onAnnotate }) {
  const [category, setCategory] = useState(g.suggest || (g.current && g.current !== 'Other' ? g.current : ''));
  const [taxMode, setTaxMode] = useState('');
  const [makeRule, setMakeRule] = useState(g.canRule);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(null);
  const [name, setName] = useState('');
  async function showLines() {
    setOpen(!open);
    if (!open && !lines) {
      try { const d = await api(`/api/admin/categorize?${qs({ view: 'rows', status: 'all', ids: g.ids.slice(0, 200).join(','), limit: 200, q: '', from: '', to: '', account: '', category: '', min: '', max: '' })}`); setLines(d.rows); }
      catch { setLines([]); }
    }
  }
  return (
    <div className="panel" style={{ marginBottom: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{g.label}</div>
          <div style={muted}>
            {g.count} line{g.count === 1 ? '' : 's'} · {money(g.total)} · {g.from === g.to ? fmtDate(g.from) : `${fmtDate(g.from)} – ${fmtDate(g.to)}`}
            {g.accounts.length > 0 && ` · ${g.accounts.join(', ')}`}
          </div>
          {g.samples.length > 0 && <div style={{ ...muted, marginTop: 2, wordBreak: 'break-word' }}>{g.samples.join('  ·  ')}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            <option value="">Category…</option>
            {catList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={taxMode} onChange={(e) => setTaxMode(e.target.value)} style={inp}>
            {TAX.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {g.canRule && (
            <label style={{ fontSize: 12 }} title="Future lines from this payee are sorted the same way">
              <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} /> remember
            </label>
          )}
          <button className="dash-filter active" disabled={busy || !category} onClick={() => onApply({ category, taxMode, makeRule: g.canRule && makeRule })}>Apply to {g.count}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        {g.suggest && category !== g.suggest && (
          <button className="dash-filter" onClick={() => setCategory(g.suggest)}>Suggested: {g.suggest} ({g.suggestN} earlier)</button>
        )}
        <button className="dash-filter" onClick={showLines}>{open ? 'Hide lines' : 'Show lines'}</button>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is this? (type a name)" style={{ ...inp, width: 190 }} />
        {name.trim() && <button className="dash-filter" disabled={busy} onClick={() => { onAnnotate(g.ids, { payee: name.trim() }); setName(''); }}>Name all {g.count}</button>}
      </div>
      {open && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="admin">
            <tbody>
              {(lines || []).map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td>{r.bankDesc || r.vendor}{r.memo && <div style={muted}>{r.memo}</div>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.gross)}</td>
                </tr>
              ))}
              {lines === null && <tr><td>Loading…</td></tr>}
            </tbody>
          </table>
          {g.count > 200 && <p className="hint" style={{ margin: '6px 0 0' }}>Showing 200 of {g.count}.</p>}
        </div>
      )}
    </div>
  );
}

// One transaction, with everything the bank said about it.
function LineRow({ r, i, checked, onToggle, catList, busy, onCategory, onAnnotate, onAgain }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(r.payeeOverride);
  const [memo, setMemo] = useState(r.userNote);
  const bank = r.bank || {};
  const details = [
    ['Bank description', bank.original_description || bank.name],
    ['Merchant', bank.merchant_name],
    ['Counterparty', (bank.counterparties || []).map((c) => c.name).join(', ')],
    ['Channel', bank.payment_channel],
    ['Reference', bank.payment_meta?.reference_number],
    ['Reason / memo', bank.payment_meta?.reason],
    ['Payer / payee', [bank.payment_meta?.payer, bank.payment_meta?.payee].filter(Boolean).join(' → ')],
    ['Bank category', bank.category ? `${bank.category.detailed || bank.category.primary}${bank.category.confidence ? ` (${bank.category.confidence.toLowerCase()})` : ''}` : ''],
    ['Place', [bank.location?.city, bank.location?.region].filter(Boolean).join(', ')]
  ].filter(([, v]) => v);
  return (
    <>
      <tr style={checked ? { background: 'rgba(47,158,111,.10)' } : undefined}>
        <td><input type="checkbox" checked={checked} onChange={() => {}} onClick={(e) => onToggle(r, i, e.shiftKey)} aria-label="Select" /></td>
        <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
        <td style={{ maxWidth: 380 }}>
          <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
            {r.label}{r.payeeOverride && <span className="pill" style={{ fontSize: 10, marginLeft: 6 }}>named</span>}
          </div>
          {r.bankDesc && r.bankDesc !== r.label && <div style={{ ...muted, wordBreak: 'break-word' }}>{r.bankDesc}</div>}
          {r.memo && <div style={{ ...muted, fontStyle: 'italic' }}>Memo: {r.memo}</div>}
          {r.userNote && <div style={{ ...muted }}>Note: {r.userNote}</div>}
          <button className="dash-filter" style={{ marginTop: 3, fontSize: 11 }} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Details / who / note'}</button>
        </td>
        <td style={{ ...muted, whiteSpace: 'nowrap' }}>{r.accountLabel || '—'}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <b>{money(r.gross)}</b>
          <div style={muted}>{r.tax == null ? 'HST not set' : r.tax > 0 ? `HST ${money(r.tax)}` : 'no HST'}</div>
        </td>
        <td style={{ minWidth: 190 }}>
          <select value={r.category || ''} disabled={busy} onChange={(e) => e.target.value && onCategory(e.target.value)} style={{ ...inp, maxWidth: 200 }}>
            <option value="">{r.category ? r.category : 'Category…'}</option>
            {catList.filter((c) => c !== r.category).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {!r.reviewed && r.suggest && r.suggest !== r.category && (
            <div><button className="dash-filter" style={{ fontSize: 11, marginTop: 3 }} disabled={busy} onClick={() => onCategory(r.suggest)}>→ {r.suggest}</button></div>
          )}
          <div style={muted}>{r.reviewed ? `✓ ${r.catSource === 'rule' ? 'by a rule' : 'reviewed'}` : 'to review'}</div>
        </td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={5} style={{ background: 'var(--card)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who was this sent to?" style={{ ...inp, width: 220 }} />
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Your note" style={{ ...inp, width: 260 }} />
              <button className="dash-filter active" disabled={busy} onClick={() => onAnnotate([r.id], { payee: who, userNote: memo })}>Save</button>
              {r.reviewed && <button className="dash-filter" disabled={busy} onClick={onAgain}>Put back in review</button>}
            </div>
            {details.length > 0
              ? <table className="admin"><tbody>{details.map(([k, v]) => <tr key={k}><td style={{ ...muted, width: 150 }}>{k}</td><td style={{ wordBreak: 'break-word' }}>{String(v)}</td></tr>)}</tbody></table>
              : <p className="hint" style={{ margin: 0 }}>The bank sent nothing more about this one.</p>}
          </td>
        </tr>
      )}
    </>
  );
}
