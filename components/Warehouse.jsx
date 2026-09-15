'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QrScanner from './QrScanner';
import { AREAS, PURPOSES, UNIT_STATUS, normCode, parseScan } from '../lib/location-codes';

// The warehouse: where every unit is standing. See lib/locations.js.
//
// Built for two hands that are rarely free — a phone held at a rack, and a
// handheld scanner plugged into the warehouse PC. The scan box takes whatever a
// scanner "types"; the camera reads the same labels on a phone. Everything a
// person does here starts with a scan:
//   scan a SPOT, then units      → they are put away there (a skid is one spot, many units)
//   scan a UNIT with no spot     → where it is, its history, and a move button
//   Count a spot, then its units → what's there against what the records say

const TABS = [
  { key: 'scan', label: 'Scan' },
  { key: 'find', label: 'Find a unit' },
  { key: 'spots', label: 'Spots' },
  { key: 'unplaced', label: 'Not placed yet' },
  { key: 'labels', label: 'Labels' }
];

async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch {
    // Warehouse wifi drops. Say so, rather than implying the scan was wrong.
    throw new Error('No connection — check the wifi and scan it again.');
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Something went wrong (${res.status}).`);
  return d;
}
const get = (params) => call(`/api/admin/warehouse?${new URLSearchParams(params)}`, { cache: 'no-store' });
const post = (body) => call('/api/admin/warehouse', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 45) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
const areaLabel = (key) => AREAS.find((a) => a.key === key)?.label || key || '';
const labelsHref = (params) => `/admin/warehouse/labels?${new URLSearchParams(params)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CSS = `
  .wh h1 { font-size: 22px; margin: 4px 0 2px; color: var(--charcoal); }
  .wh h3 { margin: 18px 0 8px; font-size: 15px; color: var(--charcoal); }
  .wh-code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; letter-spacing: .02em; }
  .wh-bar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 12px 14px; border-radius: var(--radius);
    background: var(--card); border: 2px solid var(--charcoal); margin-bottom: 12px; font-size: 15px; }
  .wh-bar .wh-code { font-size: 24px; }
  .wh-bar.is-idle { border: 1px dashed var(--line); color: var(--muted); }
  .wh-bar.is-count { border-color: var(--warn); background: var(--warnbg); color: var(--warn); }
  .wh-scan { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .wh-scan input { flex: 1 1 220px; font-size: 16px; padding: 10px 12px; }
  .wh-cam { position: relative; width: 100%; max-width: 420px; aspect-ratio: 4 / 3; margin: 0 0 12px; border-radius: var(--radius);
    overflow: hidden; background: #000; border: 3px solid transparent; transition: border-color .15s; }
  .wh-cam.is-hit { border-color: var(--ok); }
  .wh-cam video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .wh-cam-aim { position: absolute; inset: 16%; border: 3px solid rgba(255,255,255,.75); border-radius: 12px; pointer-events: none; }
  .wh-log { list-style: none; padding: 0; margin: 0; font-size: 14px; background: var(--card); border: 1px solid var(--line-soft); border-radius: var(--radius); }
  .wh-log li { padding: 8px 12px; border-bottom: 1px solid var(--line-soft); }
  .wh-log li:last-child { border-bottom: 0; }
  .wh-log .ok { color: var(--ok); } .wh-log .warn { color: var(--warn); }
  .wh-log .err { color: var(--danger); } .wh-log .info { color: var(--muted); }
  .wh-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
  .wh-tile { display: block; width: 100%; text-align: left; background: var(--card); border: 1px solid var(--line-soft);
    border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; color: var(--ink); }
  .wh-tile:hover { border-color: var(--charcoal); }
  .wh-tile.is-open { outline: 2px solid var(--charcoal); }
  .wh-tile.is-retired { opacity: .5; }
  .wh-tile .n { font-size: 12.5px; color: var(--muted); }
  .wh-tile .n.has { color: var(--charcoal); font-weight: 600; }
  .wh-tile .p { font-size: 12px; color: var(--taupe-dark); margin-top: 2px; }
  .wh-tile .m { font-size: 12px; color: var(--warn); margin-top: 2px; }
  .wh-racks { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
  .wh-rack { border: 1px solid var(--line-soft); border-radius: var(--radius); background: var(--tint); padding: 6px; }
  .wh-rack > b { display: block; font-size: 13px; padding: 2px 4px 2px; }
  .wh-rack .wh-tile { margin-top: 4px; padding: 6px 8px; }
  .wh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .wh-chip { font: 12.5px ui-monospace, Menlo, Consolas, monospace; background: var(--card); border: 1px solid var(--line);
    border-radius: 999px; padding: 3px 4px 3px 10px; display: inline-flex; align-items: center; gap: 2px; }
  .wh-chip button { border: 0; background: none; cursor: pointer; font-size: 14px; color: var(--muted); padding: 0 4px; }
  .wh-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .wh-big { font-size: 30px; line-height: 1.1; }
  .wh-hist { list-style: none; padding: 0; margin: 6px 0 0; font-size: 13px; }
  .wh-hist li { padding: 4px 0; border-bottom: 1px dashed var(--line-soft); }
`;

function Where({ unit, onOpenSpot }) {
  if (unit.location) {
    return onOpenSpot
      ? <button type="button" className="linkish wh-code" onClick={() => onOpenSpot(unit.location)}>{unit.location}</button>
      : <span className="wh-code">{unit.location}</span>;
  }
  if (unit.gone) return <span className="hint">left the warehouse</span>;
  return <span className="hint">not placed</span>;
}

const statusText = (u) => [UNIT_STATUS[u.status] || '', u.status === 'sold' && u.orderNumber ? u.orderNumber : '']
  .filter(Boolean).join(' · ');

function UnitTable({ units, onOpenUnit, onOpenSpot, extra, selectable, selected, onToggle }) {
  if (!units?.length) return null;
  return (
    <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
      <thead><tr>
        {selectable && <th style={{ width: 28 }} />}
        <th>SKU</th><th>Item</th><th>Status</th><th>Where</th><th>Since</th>
      </tr></thead>
      <tbody>
        {units.map((u) => (
          <tr key={u.sku}>
            {selectable && <td><input type="checkbox" checked={selected.has(u.sku)} onChange={() => onToggle(u.sku)} aria-label={`Select ${u.sku}`} /></td>}
            <td><button type="button" className="linkish wh-code" style={{ fontSize: 12.5 }} onClick={() => onOpenUnit(u.sku)}>{u.sku}</button></td>
            <td>{u.title || <span className="hint">—</span>}{extra && <div className="hint">{extra(u)}</div>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{statusText(u)}</td>
            <td><Where unit={u} onOpenSpot={onOpenSpot} /></td>
            <td style={{ whiteSpace: 'nowrap' }} className="hint">{u.location ? `${ago(u.movedAt)}${u.movedBy ? ` · ${u.movedBy}` : ''}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function SpotSelect({ spots, value, onChange, placeholder = 'Pick a spot…' }) {
  const active = spots.filter((s) => s.active);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', maxWidth: '100%' }}>
      <option value="">{placeholder}</option>
      {AREAS.map((a) => {
        const inArea = active.filter((s) => s.area === a.key);
        return inArea.length ? (
          <optgroup key={a.key} label={a.label}>
            {inArea.map((s) => <option key={s.code} value={s.code}>{s.code}{s.purpose ? ` — ${s.purpose}` : ''}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export default function Warehouse({ admin = false, initialUnit = '', initialSpot = '' }) {
  const [tab, setTab] = useState(initialSpot && !initialUnit ? 'spots' : 'scan');
  const [spots, setSpots] = useState([]);
  const [spotsErr, setSpotsErr] = useState('');
  const [unit, setUnit] = useState(initialUnit);
  const [spot, setSpot] = useState(initialSpot ? normCode(initialSpot) : '');
  const [counting, setCounting] = useState('');

  const loadSpots = useCallback(async () => {
    try {
      const d = await get({ view: 'locations' });
      setSpots(d.locations || []);
      setSpotsErr('');
    } catch (e) {
      setSpotsErr(e.message);
    }
  }, []);
  useEffect(() => { loadSpots(); }, [loadSpots]);

  const openSpot = useCallback((code) => { setSpot(code); setTab('spots'); }, []);
  const openUnit = useCallback((sku) => { setUnit(sku); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }, []);
  const startCount = useCallback((code) => { setCounting(code); setTab('scan'); }, []);

  return (
    <div className="wh">
      <style>{CSS}</style>
      <h1>Warehouse</h1>
      <p className="hint" style={{ marginTop: 0 }}>Scan a spot, then the units you put there. Scan a unit on its own to see where it is.</p>
      <div className="tab-row" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={'tab-btn' + (tab === t.key ? ' is-on' : '')} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {spotsErr && <div className="error-box">Couldn&apos;t load the spots: {spotsErr}</div>}
      {unit && (
        <UnitCard key={unit} sku={unit} spots={spots} onClose={() => setUnit('')}
          onChanged={loadSpots} onOpenSpot={openSpot} />
      )}
      {/* Kept mounted while another tab is open: the spot being put away to and
          the count in progress must survive a quick look at the Find tab. */}
      <div hidden={tab !== 'scan'}>
        <ScanTab visible={tab === 'scan'} spots={spots} counting={counting}
          onCountClosed={() => setCounting('')} onOpenUnit={openUnit} onOpenSpot={openSpot} onChanged={loadSpots} />
      </div>
      {tab === 'find' && <FindTab onOpenUnit={openUnit} onOpenSpot={openSpot} />}
      {tab === 'spots' && (
        <SpotsTab admin={admin} spots={spots} open={spot} onOpen={setSpot} onCount={startCount}
          onOpenUnit={openUnit} onChanged={loadSpots} />
      )}
      {tab === 'unplaced' && <UnplacedTab onOpenUnit={openUnit} />}
      {tab === 'labels' && <LabelsTab />}
    </div>
  );
}

// ── Scan ────────────────────────────────────────────────────────────────────
function ScanTab({ visible, spots, counting, onCountClosed, onOpenUnit, onOpenSpot, onChanged }) {
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [cam, setCam] = useState(false);
  const [log, setLog] = useState([]);
  const [counted, setCounted] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const chain = useRef(Promise.resolve());
  const seq = useRef(0);
  // The scan handler outlives renders (the camera holds on to it), so what it
  // reads lives in refs. The target is written to its ref synchronously: a spot
  // label and the first unit are scanned a second apart, before any re-render.
  const targetRef = useRef('');
  const live = useRef({ counting: '', codes: new Set() });
  const codes = useMemo(() => new Set(spots.filter((s) => s.active).map((s) => s.code)), [spots]);
  useEffect(() => { live.current = { counting, codes }; }, [counting, codes]);
  useEffect(() => { if (counting) { setCounted([]); setResult(null); } }, [counting]);

  useEffect(() => {
    // A desktop with a handheld scanner wants the cursor in the box. A phone does
    // not want its keyboard thrown up every time the tab opens.
    if (visible && window.matchMedia?.('(pointer: fine)').matches) input.current?.focus();
    if (!visible) setCam(false);
  }, [visible]);

  const note = useCallback((tone, msg) => {
    seq.current += 1;
    const id = seq.current;
    setLog((l) => [{ id, tone, msg }, ...l].slice(0, 40));
  }, []);

  const chooseTarget = useCallback((code) => { targetRef.current = code; setTarget(code); }, []);

  const handle = useCallback(async (raw) => {
    const p = parseScan(raw);
    if (!p) return;
    const { counting: cnt, codes: known } = live.current;
    let { kind, value } = p;
    if (kind === 'text') {
      const c = normCode(value);
      if (known.has(c)) { kind = 'location'; value = c; } else kind = 'unit';
    }
    if (kind === 'location') {
      if (cnt) {
        if (value !== cnt) note('warn', `That label is ${value} — you're counting ${cnt}. Finish the count first.`);
        return;
      }
      if (!known.has(value)) { note('err', `There's no spot called ${value}.`); return; }
      chooseTarget(value);
      note('info', `Putting away to ${value}. Now scan the units.`);
      return;
    }
    if (cnt) {
      setCounted((c) => (c.includes(value) ? c : [value, ...c]));
      return;
    }
    const to = targetRef.current;
    if (!to) { onOpenUnit(value); return; }
    setBusy(true);
    try {
      const d = await post({ action: 'move', skus: [value], code: to });
      const u = d.units?.[0] || { sku: value };
      const name = [u.sku, u.title].filter(Boolean).join(' · ');
      if (u.already) note('info', `${name} — already in ${to}.`);
      else note('ok', `✓ ${name} → ${to}${u.from ? ` (was ${u.from})` : u.wasGone ? ' (was marked as gone)' : ''}`);
      if (u.status === 'unknown') note('warn', `${u.sku} isn't on the site or in salvage yet — fine for untested stock; check the sticker if not.`);
      onChanged?.();
    } catch (e) {
      note('err', `${value}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [chooseTarget, note, onOpenUnit, onChanged]);

  // One at a time, in the order they were scanned.
  const scan = useCallback((raw) => {
    chain.current = chain.current.then(() => handle(raw)).catch(() => {});
  }, [handle]);

  function submit() {
    const v = input.current?.value ?? text;
    if (!String(v).trim()) return;
    setText('');
    scan(v);
    input.current?.focus();
  }

  async function finishCount() {
    if (!counted.length && !window.confirm(`Nothing scanned. Record ${counting} as empty?`)) return;
    setBusy(true);
    try {
      const d = await post({ action: 'count', code: counting, skus: counted });
      setResult(d);
      setCounted([]);
      onCountClosed();
      onChanged?.();
    } catch (e) {
      note('err', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {counting ? (
        <div className="wh-bar is-count">
          <span>Counting <b className="wh-code">{counting}</b> — scan every unit that is physically in it.</span>
          <b>{plural(counted.length, 'scanned', 'scanned')}</b>
          <button type="button" className="btn primary" onClick={finishCount} disabled={busy}>Finish count</button>
          <button type="button" className="btn" onClick={() => { setCounted([]); onCountClosed(); }} disabled={busy}>Cancel</button>
        </div>
      ) : target ? (
        <div className="wh-bar">
          <span>Putting away to</span> <b className="wh-code">{target}</b>
          <button type="button" className="btn" onClick={() => chooseTarget('')}>Done with this spot</button>
        </div>
      ) : (
        <div className="wh-bar is-idle">
          <span>Scan a <b>spot</b> label to start putting units away — or pick one:</span>
          <SpotSelect spots={spots} value="" onChange={(c) => c && chooseTarget(c)} />
        </div>
      )}

      <form className="wh-scan" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {/* Enter is handled on the key, not left to the form: a handheld scanner
            ends every read with an Enter, and implicit form submission is the
            part of that chain that varies between browsers and scanner modes.
            preventDefault stops the form submitting the same read a second time. */}
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Scan or type a SKU, or a spot like L3-2" aria-label="Scan or type"
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        <button type="submit" className="btn primary" disabled={!text.trim()}>Go</button>
        <button type="button" className="btn" onClick={() => setCam((c) => !c)}>{cam ? 'Stop camera' : 'Use camera'}</button>
      </form>
      {cam && visible && <QrScanner onScan={scan} />}

      {counting && counted.length > 0 && (
        <div className="wh-chips">
          {counted.map((s) => (
            <span key={s} className="wh-chip">{s}
              <button type="button" aria-label={`Remove ${s}`} onClick={() => setCounted((c) => c.filter((x) => x !== s))}>×</button>
            </span>
          ))}
        </div>
      )}

      {result && (
        <div className="panel">
          <div className="wh-row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Count of <span className="wh-code">{result.code}</span></h3>
            <button type="button" className="btn" onClick={() => setResult(null)}>Close</button>
          </div>
          <p style={{ margin: '8px 0' }}>
            {result.confirmed.length} of {plural(result.expected, 'recorded unit')} found where the records say.
            {result.found.length ? ` ${plural(result.found.length, 'unit')} found here that were recorded elsewhere — moved onto ${result.code}.` : ''}
          </p>
          {result.missing.length > 0 && (
            <>
              <h3>Recorded in {result.code} but not found ({result.missing.length})</h3>
              <p className="hint">Left recorded in {result.code}. Scan each one wherever it turns up — that moves it.</p>
              <UnitTable units={result.missing} onOpenUnit={onOpenUnit} onOpenSpot={onOpenSpot} />
            </>
          )}
          {result.found.length > 0 && (
            <>
              <h3>Found here</h3>
              <UnitTable units={result.found} onOpenUnit={onOpenUnit} onOpenSpot={onOpenSpot}
                extra={(u) => (u.from ? `was recorded in ${u.from}` : u.wasGone ? 'was marked as gone' : 'had never been placed')} />
            </>
          )}
        </div>
      )}

      {log.length > 0 && (
        <ul className="wh-log" aria-live="polite">
          {log.map((l) => <li key={l.id} className={l.tone}>{l.msg}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── One unit ────────────────────────────────────────────────────────────────
function UnitCard({ sku, spots, onClose, onChanged, onOpenSpot }) {
  const [u, setU] = useState(null);
  const [err, setErr] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [askOut, setAskOut] = useState(false);
  const [outNote, setOutNote] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await get({ view: 'unit', sku });
      setU(d.unit);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [sku]);
  useEffect(() => { load(); }, [load]);

  async function move(code) {
    setBusy(true);
    setErr('');
    try {
      await post(code
        ? { action: 'move', skus: [u.sku], code }
        : { action: 'out', skus: [u.sku], note: outNote });
      setTo('');
      setAskOut(false);
      setOutNote('');
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ borderColor: 'var(--charcoal)' }}>
      <div className="wh-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="wh-code" style={{ fontSize: 16 }}>{u?.sku || sku}</div>
          {u && <div>{u.title || <span className="hint">The site doesn&apos;t know this SKU yet</span>}</div>}
          {u && <div className="hint">{[statusText(u), u.condition].filter(Boolean).join(' · ')}</div>}
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close">Close</button>
      </div>
      {err && <div className="error-box">{err}</div>}
      {!u && !err && <p className="hint">Looking it up…</p>}
      {u && (
        <>
          <div style={{ margin: '12px 0' }}>
            {u.location ? (
              <>
                <div className="hint">It is in</div>
                <button type="button" className="linkish wh-code wh-big" onClick={() => onOpenSpot(u.location)}>{u.location}</button>
                <div className="hint">since {ago(u.movedAt)}{u.movedBy ? ` · ${u.movedBy}` : ''}</div>
              </>
            ) : u.gone ? (
              <div className="wh-big" style={{ color: 'var(--muted)' }}>Left the warehouse</div>
            ) : (
              <div className="wh-big" style={{ color: 'var(--warn)' }}>Not placed yet</div>
            )}
          </div>
          <div className="wh-row">
            <SpotSelect spots={spots} value={to} onChange={setTo} placeholder={u.location ? 'Move it to…' : 'Put it in…'} />
            <button type="button" className="btn primary" disabled={!to || busy} onClick={() => move(to)}>
              {u.location ? 'Move' : 'Place'}
            </button>
            <a className="btn" target="_blank" rel="noopener noreferrer" href={labelsHref({ type: 'units', skus: u.sku })}>Print sticker</a>
            {!u.gone && !askOut && (
              <button type="button" className="btn" onClick={() => setAskOut(true)}>It left the warehouse…</button>
            )}
          </div>
          {askOut && (
            <div className="wh-row" style={{ marginTop: 8 }}>
              <input value={outNote} onChange={(e) => setOutNote(e.target.value)} placeholder="Why — returned to vendor, scrapped…"
                style={{ flex: '1 1 220px' }} />
              <button type="button" className="btn danger" disabled={busy} onClick={() => move(null)}>Record it as gone</button>
              <button type="button" className="btn" onClick={() => setAskOut(false)}>Cancel</button>
            </div>
          )}
          {u.history?.length > 0 && (
            <>
              <h3>History</h3>
              <ul className="wh-hist">
                {u.history.map((h, i) => (
                  <li key={i}>
                    <b className="wh-code">{h.location || 'Left the warehouse'}</b>
                    <span className="hint"> · {ago(h.movedAt)}{h.movedBy ? ` · ${h.movedBy}` : ''}{h.via === 'count' ? ' · found in a count' : ''}{h.note ? ` · ${h.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Find ────────────────────────────────────────────────────────────────────
function FindTab({ onOpenUnit, onOpenSpot }) {
  const [q, setQ] = useState('');
  const [units, setUnits] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setUnits(null); return undefined; }
    let current = true;
    const t = setTimeout(async () => {
      try {
        const d = await get({ view: 'find', q: term });
        if (current) { setUnits(d.units || []); setErr(''); }
      } catch (e) {
        if (current) setErr(e.message);
      }
    }, 300);
    return () => { current = false; clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, model, make or description"
        aria-label="Find a unit" style={{ width: '100%', maxWidth: 480, fontSize: 16, padding: '10px 12px', marginBottom: 12 }} />
      {err && <div className="error-box">{err}</div>}
      {units && !units.length && <p className="hint">Nothing matches.</p>}
      <UnitTable units={units} onOpenUnit={onOpenUnit} onOpenSpot={onOpenSpot} />
    </div>
  );
}

// ── Spots ───────────────────────────────────────────────────────────────────
function SpotTile({ s, open, onOpen }) {
  return (
    <button type="button" className={'wh-tile' + (open ? ' is-open' : '') + (s.active ? '' : ' is-retired')} onClick={() => onOpen(s.code)}>
      <div className="wh-code">{s.code}</div>
      <div className={'n' + (s.count ? ' has' : '')}>{s.count ? plural(s.count, 'unit') : 'empty'}{s.active ? '' : ' · retired'}</div>
      {s.purpose && <div className="p">{s.purpose}</div>}
      {s.lastMissing > 0 && <div className="m">{s.lastMissing} not found at last count</div>}
    </button>
  );
}

function SpotsTab({ admin, spots, open, onOpen, onCount, onOpenUnit, onChanged }) {
  const [showRetired, setShowRetired] = useState(false);
  const shown = spots.filter((s) => s.active || s.count > 0 || showRetired);
  const total = spots.reduce((n, s) => n + s.count, 0);

  return (
    <div>
      {open && (
        <SpotPanel key={open} code={open} admin={admin} onClose={() => onOpen('')} onCount={onCount}
          onOpenUnit={onOpenUnit} onOpenSpot={onOpen} onChanged={onChanged} />
      )}
      <p className="hint" style={{ marginTop: 0 }}>{plural(total, 'unit')} recorded across {plural(spots.filter((s) => s.active).length, 'spot')}.</p>
      {AREAS.map((a) => {
        const inArea = shown.filter((s) => s.area === a.key);
        if (!inArea.length) return null;
        const racks = inArea.filter((s) => s.kind === 'rack');
        const others = inArea.filter((s) => s.kind !== 'rack');
        // A rack section is drawn as the rack is built: top shelf on top.
        const sections = [...new Set(racks.map((s) => s.code.replace(/-\d+$/, '')))];
        return (
          <section key={a.key}>
            <h3>{a.label}</h3>
            {sections.length > 0 && (
              <div className="wh-racks">
                {sections.map((sec) => (
                  <div key={sec} className="wh-rack">
                    <b>{sec}</b>
                    {racks.filter((s) => s.code.replace(/-\d+$/, '') === sec)
                      .sort((x, y) => (y.level || 0) - (x.level || 0))
                      .map((s) => <SpotTile key={s.code} s={s} open={open === s.code} onOpen={onOpen} />)}
                  </div>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="wh-tiles" style={{ marginTop: sections.length ? 8 : 0 }}>
                {others.map((s) => <SpotTile key={s.code} s={s} open={open === s.code} onOpen={onOpen} />)}
              </div>
            )}
          </section>
        );
      })}
      {admin && (
        <>
          <label className="hint" style={{ display: 'block', margin: '14px 0' }}>
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired spots
          </label>
          <AddSpot onAdded={onChanged} />
        </>
      )}
    </div>
  );
}

function SpotPanel({ code, admin, onClose, onCount, onOpenUnit, onOpenSpot, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await get({ view: 'location', code });
      setD(r);
      setPurpose(r.spot.purpose || '');
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  async function update(patch) {
    setBusy(true);
    setErr('');
    try {
      await post({ action: 'update', code, ...patch });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const s = d?.spot;
  return (
    <div className="panel" style={{ borderColor: 'var(--charcoal)' }}>
      <div className="wh-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="wh-code wh-big">{code}</div>
          {s && (
            <div className="hint">
              {areaLabel(s.area)}{s.kind === 'rack' && s.level ? ` · shelf ${s.level} from the floor` : ''}{s.note ? ` · ${s.note}` : ''}
              {s.lastCountedAt ? ` · counted ${ago(s.lastCountedAt)}` : ' · never counted'}
              {s.active ? '' : ' · RETIRED'}
            </div>
          )}
        </div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {err && <div className="error-box">{err}</div>}
      {s && (
        <>
          <div className="wh-row" style={{ margin: '12px 0' }}>
            <button type="button" className="btn primary" disabled={!s.active} onClick={() => onCount(code)}>Count this spot</button>
            <a className="btn" target="_blank" rel="noopener noreferrer" href={labelsHref({ type: 'spots', codes: code })}>Print its label</a>
            <input list="wh-purposes" value={purpose} onChange={(e) => setPurpose(e.target.value)}
              placeholder="What it's used for" aria-label="Purpose" style={{ width: 200 }} />
            <datalist id="wh-purposes">{PURPOSES.map((p) => <option key={p} value={p} />)}</datalist>
            <button type="button" className="btn" disabled={busy || purpose === (s.purpose || '')} onClick={() => update({ purpose })}>Save</button>
            {admin && (s.active
              ? <button type="button" className="btn danger" disabled={busy} onClick={() => update({ active: false })}>Retire spot</button>
              : <button type="button" className="btn" disabled={busy} onClick={() => update({ active: true })}>Bring it back</button>)}
          </div>
          {d.units.length
            ? <UnitTable units={d.units} onOpenUnit={onOpenUnit} onOpenSpot={onOpenSpot} />
            : <p className="hint">Nothing recorded in {code}.</p>}
        </>
      )}
    </div>
  );
}

function AddSpot({ onAdded }) {
  const [f, setF] = useState({ kind: 'rack', area: 'left', code: '', levels: '3', purpose: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await post({ action: 'add', ...f });
      setMsg([
        d.created.length ? `Added ${d.created.join(', ')}.` : '',
        d.existing.length ? `Already there: ${d.existing.join(', ')}.` : ''
      ].filter(Boolean).join(' '));
      setF((x) => ({ ...x, code: '' }));
      onAdded?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={add}>
      <h3 style={{ marginTop: 0 }}>Add a spot</h3>
      <div className="wh-row">
        <select value={f.kind} onChange={set('kind')} style={{ width: 'auto' }}>
          <option value="rack">Rack section</option>
          <option value="lane">Floor lane</option>
          <option value="zone">Holding area</option>
        </select>
        {f.kind !== 'zone' && (
          <select value={f.area} onChange={set('area')} style={{ width: 'auto' }}>
            {AREAS.filter((a) => a.key !== 'zone').map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        )}
        <input value={f.code} onChange={set('code')} placeholder={f.kind === 'rack' ? 'Code, e.g. R7' : f.kind === 'lane' ? 'Code, e.g. V5' : 'Code, e.g. RETURNS'}
          style={{ width: 170 }} aria-label="Code" />
        {f.kind === 'rack' && (
          <label className="hint" style={{ margin: 0 }}>
            shelves high <input type="number" min="1" max="8" value={f.levels} onChange={set('levels')} style={{ width: 60 }} />
          </label>
        )}
        <input list="wh-purposes-add" value={f.purpose} onChange={set('purpose')} placeholder="Purpose (optional)" style={{ width: 180 }} />
        <datalist id="wh-purposes-add">{PURPOSES.map((p) => <option key={p} value={p} />)}</datalist>
        <button type="submit" className="btn primary" disabled={busy || !f.code.trim()}>Add</button>
      </div>
      {f.kind === 'rack' && f.code.trim() && Number(f.levels) > 0 && (
        <p className="hint">Makes {Array.from({ length: Math.min(8, Number(f.levels)) }, (_, i) => `${normCode(f.code)}-${i + 1}`).join(', ')} — shelf 1 is the bottom.</p>
      )}
      {msg && <div className="notice-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}
    </form>
  );
}

// ── Not placed yet ──────────────────────────────────────────────────────────
function UnplacedTab({ onOpenUnit }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    let current = true;
    get({ view: 'unplaced' })
      .then((r) => { if (current) setD(r); })
      .catch((e) => { if (current) setErr(e.message); });
    return () => { current = false; };
  }, []);

  const toggle = (sku) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(sku)) next.delete(sku); else next.add(sku);
    return next;
  });
  const units = d?.units || [];
  const allOn = units.length > 0 && units.every((u) => selected.has(u.sku));
  // A URL of a few hundred SKUs is fine; thousands is not. Print in batches.
  const printable = [...selected].slice(0, 200);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Units the site knows about — on sale, salvage, or sold in the last 45 days and not yet gone — that have never been
        scanned into a spot. Untested stock that only lives in the tracker shows up once it has been scanned somewhere.
      </p>
      {err && <div className="error-box">{err}</div>}
      {!d && !err && <p className="hint">Loading…</p>}
      {d && (
        <>
          <div className="wh-row" style={{ marginBottom: 10 }}>
            <b>{plural(d.total, 'unit')} not placed{d.total > units.length ? ` (showing ${units.length})` : ''}</b>
            {units.length > 0 && (
              <label className="hint" style={{ margin: 0 }}>
                <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(units.map((u) => u.sku)))} /> Select all
              </label>
            )}
            {printable.length > 0 && (
              <a className="btn primary" target="_blank" rel="noopener noreferrer"
                href={labelsHref({ type: 'units', skus: printable.join(',') })}>
                Print {plural(printable.length, 'sticker')}
              </a>
            )}
            {selected.size > 200 && <span className="hint">200 at a time — print these, then the rest.</span>}
          </div>
          {units.length ? (
            <UnitTable units={units} onOpenUnit={onOpenUnit} selectable selected={selected} onToggle={toggle} />
          ) : <p>Everything the site knows about has a spot.</p>}
        </>
      )}
    </div>
  );
}

// ── Labels ──────────────────────────────────────────────────────────────────
function LabelsTab() {
  const [areas, setAreas] = useState(() => AREAS.map((a) => a.key));
  const [spotFormat, setSpotFormat] = useState('4x6');
  const [skuText, setSkuText] = useState('');
  const [unitFormat, setUnitFormat] = useState('roll');
  const skus = [...new Set(skuText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  const flip = (k) => setAreas((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  return (
    <div className="disp-setup">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Spot labels</h3>
        <p className="hint">One per spot: the code in large type and a QR code. Racks get one per shelf; lanes get a sign for the end of the lane.</p>
        {AREAS.map((a) => (
          <label key={a.key} style={{ display: 'block', fontSize: 14 }}>
            <input type="checkbox" checked={areas.includes(a.key)} onChange={() => flip(a.key)} /> {a.label}
          </label>
        ))}
        <div className="wh-row" style={{ marginTop: 10 }}>
          <select value={spotFormat} onChange={(e) => setSpotFormat(e.target.value)} style={{ width: 'auto' }}>
            <option value="4x6">4 × 6 in label</option>
            <option value="letter">Letter paper</option>
          </select>
          <a className={'btn primary' + (areas.length ? '' : ' is-disabled')} target="_blank" rel="noopener noreferrer"
            aria-disabled={!areas.length}
            href={areas.length ? labelsHref({ type: 'spots', area: areas.join(','), format: spotFormat }) : undefined}>
            Open labels
          </a>
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>SKU stickers</h3>
        <p className="hint">
          Paste SKUs — one per line or comma-separated. Intake offers these right after a unit is added, and
          <b> Not placed yet</b> can print them for existing stock.
        </p>
        <textarea value={skuText} onChange={(e) => setSkuText(e.target.value)} rows={5} placeholder={'IN-MF3K2Z1A-001\nIN-MF3K2Z1A-002'}
          style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} />
        <div className="wh-row" style={{ marginTop: 10 }}>
          <select value={unitFormat} onChange={(e) => setUnitFormat(e.target.value)} style={{ width: 'auto' }}>
            <option value="roll">Label roll — 2.25 × 1.25 in</option>
            <option value="sheet">Letter sheet — 30 per page</option>
          </select>
          {skus.length > 0 && (
            <a className="btn primary" target="_blank" rel="noopener noreferrer"
              href={labelsHref({ type: 'units', skus: skus.slice(0, 200).join(','), format: unitFormat })}>
              Print {plural(Math.min(200, skus.length), 'sticker')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
