'use client';
import { useCallback, useEffect, useState } from 'react';
import { money } from '../lib/constants';
import { PART_CONDITIONS } from '../lib/parts-labels';

// The parts shelf. See lib/parts.js.
//
// Four things happen here, and they are the four tabs: find a part and take it,
// strip a salvage unit, answer the road crew's requests, and book in parts we
// bought. Everything hangs off the same ledger — on-hand is always a sum, never
// a number somebody typed.

const TABS = [
  { key: 'shelf', label: 'Find a part' },
  { key: 'partout', label: 'Part out a unit' },
  { key: 'requests', label: 'Requests' },
  { key: 'receive', label: 'Book parts in' }
];

async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch {
    throw new Error('No connection — check the wifi and try again.');
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Something went wrong (${res.status}).`);
  return d;
}
const get = (params) => call(`/api/admin/parts?${new URLSearchParams(params)}`, { cache: 'no-store' });
const post = (body) => call('/api/admin/parts', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const partTitle = (p) => [p.partNumber, p.name].filter(Boolean).join(' · ');

const CSS = `
  .pt h1 { font-size: 22px; margin: 4px 0 2px; color: var(--charcoal); }
  .pt h3 { margin: 16px 0 8px; font-size: 15px; color: var(--charcoal); }
  .pt-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
  .pt-kpi { background: var(--card); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 10px 14px; min-width: 120px; }
  .pt-kpi b { display: block; font-size: 20px; color: var(--charcoal); font-family: var(--font-head); }
  .pt-kpi span { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .pt-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .pt-num { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; }
  .pt-spot { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; background: var(--tint); border-radius: 6px; padding: 1px 6px; }
  .pt-none { color: var(--warn); font-size: 13px; }
  .pt-card { background: var(--card); border: 2px solid var(--charcoal); border-radius: var(--radius); padding: 16px; margin-bottom: 14px; }
  .pt-hist { list-style: none; padding: 0; margin: 6px 0 0; font-size: 13px; }
  .pt-hist li { padding: 4px 0; border-bottom: 1px dashed var(--line-soft); }
  .pt-in { font-size: 16px; padding: 9px 11px; }
`;

export default function Parts({ admin = false }) {
  const [tab, setTab] = useState('shelf');
  const [overview, setOverview] = useState(null);
  const [openPart, setOpenPart] = useState(null);
  const [err, setErr] = useState('');

  const loadOverview = useCallback(async () => {
    try { setOverview(await get({})); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  return (
    <div className="pt">
      <style>{CSS}</style>
      <h1>Parts</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        Every part on the shelf, where it is, and what it came out of. On-hand is worked out from what
        has gone in and out — nobody types a count.
      </p>
      {err && <div className="error-box">{err}</div>}
      {overview && (
        <div className="pt-kpis">
          <div className="pt-kpi"><b>{overview.pieces}</b><span>pieces</span></div>
          <div className="pt-kpi"><b>{overview.kinds}</b><span>different parts</span></div>
          {admin && <div className="pt-kpi"><b>{money(overview.valueAtCost || 0)}</b><span>at cost</span></div>}
          <div className="pt-kpi"><b>{overview.openRequests}</b><span>requests waiting</span></div>
          <div className="pt-kpi"><b>{overview.salvage?.length || 0}</b><span>salvage units to strip</span></div>
        </div>
      )}
      <div className="tab-row" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={'tab-btn' + (tab === t.key ? ' is-on' : '')} onClick={() => setTab(t.key)}>
            {t.label}{t.key === 'requests' && overview?.openRequests ? ` (${overview.openRequests})` : ''}
          </button>
        ))}
      </div>
      {openPart && (
        <PartCard key={openPart} id={openPart} admin={admin} onClose={() => setOpenPart(null)} onChanged={loadOverview} />
      )}
      {tab === 'shelf' && <Shelf onOpen={setOpenPart} />}
      {tab === 'partout' && <PartOut admin={admin} salvage={overview?.salvage || []} onChanged={loadOverview} onOpen={setOpenPart} />}
      {tab === 'requests' && <Requests admin={admin} onChanged={loadOverview} onOpen={setOpenPart} />}
      {tab === 'receive' && <Receive admin={admin} onChanged={loadOverview} onOpen={setOpenPart} />}
    </div>
  );
}

function PartList({ parts, onOpen }) {
  if (!parts?.length) return null;
  return (
    <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
      <thead><tr><th>Part</th><th>Fits</th><th>On hand</th><th>Where</th></tr></thead>
      <tbody>
        {parts.map((p) => (
          <tr key={p.id}>
            <td>
              <button type="button" className="linkish" onClick={() => onOpen(p.id)}>
                <span className="pt-num">{p.partNumber || '—'}</span> {p.name}
              </button>
              {p.brand && <div className="hint">{p.brand}</div>}
            </td>
            <td className="hint">{p.fits?.length ? p.fits.slice(0, 4).join(', ') : '—'}</td>
            <td>
              {p.onHand > 0 ? <b>{p.onHand}</b> : <span className="pt-none">none</span>}
              {p.held > 0 && <div className="hint">{p.held} spoken for</div>}
            </td>
            <td>{p.spots?.length
              ? p.spots.map((s, i) => <span key={i} className="pt-spot" style={{ marginRight: 4 }}>{s.location || 'no spot'} ×{s.qty}</span>)
              : <span className="hint">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Shelf({ onOpen }) {
  const [q, setQ] = useState('');
  const [parts, setParts] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const d = await get({ view: 'search', q });
        if (live) { setParts(d.parts); setErr(''); }
      } catch (e) { if (live) setErr(e.message); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <input className="pt-in" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', maxWidth: 480, marginBottom: 12 }}
        placeholder="Part number, name, brand, or a model it fits" aria-label="Find a part" />
      {err && <div className="error-box">{err}</div>}
      {parts && !parts.length && <p className="hint">Nothing matches. Book it in under <b>Book parts in</b> if it is new to us.</p>}
      <PartList parts={parts} onOpen={onOpen} />
    </div>
  );
}

function PartCard({ id, admin, onClose, onChanged }) {
  const [part, setPart] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [use, setUse] = useState({ qty: '1', location: '', ref: '' });
  const [req, setReq] = useState({ qty: '1', jobRef: '', reason: '' });
  const [more, setMore] = useState({ qty: '1', condition: 'used', location: '', why: 'count', cost: '', note: '' });

  const load = useCallback(async () => {
    try { setPart((await get({ view: 'part', id })).part); setErr(''); } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(body, done) {
    setBusy(true); setErr(''); setMsg('');
    try {
      await post({ ...body, partId: id });
      setMsg(done);
      await load();
      onChanged?.();
      return true;
    } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  }

  if (!part) {
    return <div className="pt-card">{err ? <div className="error-box">{err}</div> : <p className="hint">Looking it up…</p>}</div>;
  }
  return (
    <div className="pt-card">
      <div className="pt-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 17 }}><span className="pt-num">{part.partNumber || '(no part number)'}</span> {part.name}</div>
          <div className="hint">
            {[part.brand, part.category].filter(Boolean).join(' · ')}
            {part.fits?.length ? ` · fits ${part.fits.join(', ')}` : ''}
          </div>
        </div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}

      <div className="pt-row" style={{ margin: '12px 0' }}>
        <div><b style={{ fontSize: 24 }}>{part.onHand}</b> <span className="hint">on hand</span></div>
        {part.held > 0 && <div className="hint">· {part.held} spoken for, {part.available} free</div>}
        {part.spots?.map((s, i) => (
          <span key={i} className="pt-spot">{s.location || 'no spot'} ×{s.qty}</span>
        ))}
        {admin && <span className="hint">· {money(part.valueAtCost || 0)} at cost</span>}
      </div>

      <h3>Take one off the shelf</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        For a repair on the floor — mark it as you take it. A service tech on the road asks instead, below.
      </p>
      <div className="pt-row">
        <input value={use.qty} onChange={(e) => setUse({ ...use, qty: e.target.value })} inputMode="numeric"
          style={{ width: 70 }} aria-label="How many" />
        <input value={use.location} onChange={(e) => setUse({ ...use, location: e.target.value.toUpperCase() })}
          placeholder="From spot (optional)" style={{ width: 150 }} aria-label="Spot" />
        <input value={use.ref} onChange={(e) => setUse({ ...use, ref: e.target.value })}
          placeholder="Which unit / job?" style={{ width: 180 }} aria-label="Used on" />
        <button type="button" className="btn primary" disabled={busy || !(Number(use.qty) > 0)}
          onClick={() => act({ action: 'use', qty: Number(use.qty), location: use.location || undefined, ref: use.ref },
            `Took ${use.qty} off the shelf.`)}>Take it</button>
      </div>

      <h3>Ask for one (service call)</h3>
      <div className="pt-row">
        <input value={req.qty} onChange={(e) => setReq({ ...req, qty: e.target.value })} inputMode="numeric"
          style={{ width: 70 }} aria-label="How many" />
        <input value={req.jobRef} onChange={(e) => setReq({ ...req, jobRef: e.target.value })}
          placeholder="Job / order (RS-1021)" style={{ width: 170 }} aria-label="Job" />
        <input value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })}
          placeholder="What it's for" style={{ width: 200 }} aria-label="Reason" />
        <button type="button" className="btn" disabled={busy || !(Number(req.qty) > 0)}
          onClick={() => act({ action: 'request', qty: Number(req.qty), jobRef: req.jobRef, reason: req.reason },
            'Asked — an admin has to approve it.')}>Request it</button>
      </div>

      {/* More of THIS part, onto THIS record. Book parts in finds an existing
          part only by its number, so a part with no number booked in twice
          became two parts with the stock split between them — this is the way
          to add to the one that exists. "Was already here" books it as a count,
          not a purchase, so a shelf stocked from what was lying around doesn't
          read as bought in. */}
      <h3>Put more on the shelf</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        More of this same part — found on another shelf, or a new box arrived. Adds to this one instead of making a second.
      </p>
      <div className="pt-row">
        <input value={more.qty} onChange={(e) => setMore({ ...more, qty: e.target.value })} inputMode="numeric"
          style={{ width: 70 }} aria-label="How many" />
        <select value={more.condition} onChange={(e) => setMore({ ...more, condition: e.target.value })} style={{ width: 'auto' }}
          aria-label="Condition">
          {Object.entries(PART_CONDITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input value={more.location} onChange={(e) => setMore({ ...more, location: e.target.value.toUpperCase() })}
          placeholder="Into spot" style={{ width: 120 }} aria-label="Into spot" />
        <select value={more.why} onChange={(e) => setMore({ ...more, why: e.target.value })} style={{ width: 'auto' }}
          aria-label="Where they came from">
          <option value="count">Was already here</option>
          <option value="purchase">Bought in</option>
        </select>
        {admin && more.why === 'purchase' && (
          <input value={more.cost} onChange={(e) => setMore({ ...more, cost: e.target.value })} inputMode="decimal"
            placeholder="Cost each $" style={{ width: 110 }} aria-label="Cost each" />
        )}
        <input value={more.note} onChange={(e) => setMore({ ...more, note: e.target.value })}
          placeholder="Note (optional)" style={{ width: 160 }} aria-label="Note" />
        <button type="button" className="btn primary" disabled={busy || !(Number(more.qty) > 0)}
          onClick={async () => {
            const n = Number(more.qty);
            const ok = await act({
              action: more.why === 'count' ? 'count' : 'receive',
              qty: n, condition: more.condition, location: more.location || undefined, note: more.note,
              cost: admin && more.why === 'purchase' && more.cost ? Number(more.cost) : undefined
            }, `Put ${n} more on the shelf${more.location ? ` in ${more.location}` : ''}.`);
            if (ok) setMore((m) => ({ ...m, qty: '1', cost: '', note: '' }));
          }}>Put on shelf</button>
      </div>

      {part.moves?.length > 0 && (
        <>
          <h3>History</h3>
          <ul className="pt-hist">
            {part.moves.map((m) => (
              <li key={m.id}>
                <b>{m.qty > 0 ? `+${m.qty}` : m.qty}</b>{' '}
                {m.location && <span className="pt-spot">{m.location}</span>}{' '}
                <span className="hint">
                  {MOVE_LABEL[m.reason] || m.reason}{m.ref ? ` · ${m.ref}` : ''}{m.by ? ` · ${m.by}` : ''} · {ago(m.at)}
                  {admin && m.cost != null ? ` · ${money(m.cost)} each` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const MOVE_LABEL = {
  harvest: 'cut out of a salvage unit',
  purchase: 'bought in',
  use_unit: 'used on a repair',
  use_job: 'used on a service call',
  sale: 'sold',
  count: 'found in a count',
  adjust: 'correction'
};

function PartOut({ admin, salvage, onChanged, onOpen }) {
  const [sku, setSku] = useState('');
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ partNumber: '', name: '', brand: '', condition: 'used', estValue: '', location: '', fits: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async (which) => {
    if (!which) { setState(null); return; }
    try { setState(await get({ view: 'part_out', sku: which })); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(sku); }, [sku, load]);

  async function addPart() {
    if (!form.name.trim() && !form.partNumber.trim()) { setErr('Name the part, or give its number.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await post({
        action: 'harvest', salvageSku: sku,
        part: { partNumber: form.partNumber, name: form.name, brand: form.brand, fits: form.fits },
        condition: form.condition, estValue: form.estValue || undefined, location: form.location || undefined
      });
      setForm({ ...form, partNumber: '', name: '', estValue: '' });
      await load(sku);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await post({ action: 'finish_part_out', sku });
      setDone(d);
      setSku('');
      setState(null);
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const unitCost = state?.unit?.cost;
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Strip a salvage unit and put its parts on the shelf. What each part cost is worked out at the end,
        when the unit is finished — a purchased unit&apos;s cost is split across what came out of it, weighted by
        what you reckon each is worth. A haul-away cost nothing, so its parts cost nothing.
      </p>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}

      {done && (
        <div className="notice-box">
          <b>{done.sku} is parted out.</b>{' '}
          {done.costed
            ? `${money(done.unitCost)} spread across ${plural(done.parts.length, 'part')}.`
            : `${plural(done.parts.length, 'part')} on the shelf at no cost — the unit was a haul-away.`}
          <button type="button" className="linkish" style={{ marginLeft: 8 }} onClick={() => setDone(null)}>Close</button>
        </div>
      )}

      <div className="pt-row" style={{ marginBottom: 12 }}>
        <select value={sku} onChange={(e) => { setSku(e.target.value); setDone(null); }} style={{ width: 'auto', maxWidth: '100%' }}>
          <option value="">Pick a salvage unit…</option>
          {salvage.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.sku} — {s.title || [s.make, s.model].filter(Boolean).join(' ')}{s.cost ? ` (cost ${money(s.cost)})` : ' (haul-away)'}
            </option>
          ))}
        </select>
        {!salvage.length && <span className="hint">No salvage units. Sync salvage from Operations first.</span>}
      </div>

      {state?.unit && (
        <div className="pt-card">
          <div style={{ fontSize: 16 }}>
            <span className="pt-num">{state.unit.sku}</span> {state.unit.title || [state.unit.make, state.unit.model].filter(Boolean).join(' ')}
          </div>
          <div className="hint">
            {admin
              ? (unitCost > 0 ? `Cost ${money(unitCost)} — split across what comes off it.` : 'Haul-away — its parts cost nothing.')
              : (unitCost > 0 ? 'A purchased unit — its cost is split across what comes off it.' : 'Haul-away — its parts cost nothing.')}
          </div>

          <h3>Take a part off it</h3>
          <div className="pt-row">
            <input value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })}
              placeholder="Part number" style={{ width: 150 }} aria-label="Part number" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="What is it? (control board)" style={{ width: 210 }} aria-label="Name" />
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="Brand" style={{ width: 110 }} aria-label="Brand" />
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ width: 'auto' }}>
              {Object.entries(PART_CONDITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <input value={form.estValue} onChange={(e) => setForm({ ...form, estValue: e.target.value })}
              placeholder="Worth ~$" style={{ width: 100 }} inputMode="decimal" aria-label="Estimated value" />
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value.toUpperCase() })}
              placeholder="Into spot" style={{ width: 120 }} aria-label="Spot" />
            <button type="button" className="btn primary" disabled={busy} onClick={addPart}>Add part</button>
          </div>
          <p className="hint">
            &quot;Worth ~$&quot; is only used to split the unit&apos;s cost — a $150 board and a $20 valve out of one machine
            did not each carry half of it. Leave them all blank and the cost splits evenly.
          </p>

          {state.parts.length > 0 && (
            <>
              <h3>Off this unit so far ({state.parts.length})</h3>
              <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
                <thead><tr><th>Part</th><th>Condition</th><th>Worth</th><th>Spot</th><th /></tr></thead>
                <tbody>
                  {state.parts.map((p) => (
                    <tr key={p.moveId}>
                      <td><button type="button" className="linkish" onClick={() => onOpen(p.partId)}>
                        <span className="pt-num">{p.partNumber || '—'}</span> {p.name}
                      </button></td>
                      <td>{PART_CONDITIONS[p.condition] || p.condition}</td>
                      <td>{p.estValue ? money(p.estValue) : <span className="hint">—</span>}</td>
                      <td>{p.location ? <span className="pt-spot">{p.location}</span> : <span className="hint">—</span>}</td>
                      <td><button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 12.5 }} disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try { await post({ action: 'harvest_remove', moveId: p.moveId }); await load(sku); onChanged?.(); }
                          catch (e) { setErr(e.message); } finally { setBusy(false); }
                        }}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="pt-row" style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" disabled={busy} onClick={finish}>
                  Finished with {state.unit.sku} — cost it up
                </button>
                <span className="hint">Marks the unit parted out. Nothing else comes off it afterwards.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Requests({ admin, onChanged, onOpen }) {
  const [requests, setRequests] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('open');

  const load = useCallback(async () => {
    try { setRequests((await get({ view: 'requests', status: scope })).requests); setErr(''); } catch (e) { setErr(e.message); }
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function act(body) {
    setBusy(true); setErr('');
    try { await post(body); await load(); onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        A service tech asks; an admin answers. The part is held from the moment it is asked for, so the same
        last one can&apos;t be promised twice — and the shelf only changes when somebody physically picks it up.
      </p>
      <div className="tab-row" style={{ border: 0 }}>
        {['open', 'all'].map((s) => (
          <button key={s} type="button" className={'tab-btn' + (scope === s ? ' is-on' : '')} onClick={() => setScope(s)}>
            {s === 'open' ? 'Waiting' : 'Everything'}
          </button>
        ))}
      </div>
      {err && <div className="error-box">{err}</div>}
      {requests && !requests.length && <p>Nothing waiting.</p>}
      {requests?.length > 0 && (
        <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
          <thead><tr><th>Part</th><th>For</th><th>Asked</th><th>Status</th><th /></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="linkish" onClick={() => onOpen(r.partId)}>
                    <span className="pt-num">{r.partNumber || '—'}</span> {r.name}
                  </button>
                  <div className="hint">×{r.qty}</div>
                </td>
                <td>{r.jobRef || <span className="hint">—</span>}<div className="hint">{r.reason || ''}</div></td>
                <td className="hint">{r.requestedBy || '—'}<br />{ago(r.createdAt)}</td>
                <td>
                  {r.status}
                  {r.decidedBy && <div className="hint">by {r.decidedBy}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status === 'pending' && admin && (
                    <>
                      <button type="button" className="btn primary" style={{ padding: '3px 9px', fontSize: 12.5 }} disabled={busy}
                        onClick={() => act({ action: 'decide', id: r.id, approve: true })}>Approve</button>
                      <button type="button" className="btn" style={{ padding: '3px 9px', fontSize: 12.5, marginLeft: 6 }} disabled={busy}
                        onClick={() => act({ action: 'decide', id: r.id, approve: false })}>Refuse</button>
                    </>
                  )}
                  {r.status === 'pending' && !admin && <span className="hint">waiting on an admin</span>}
                  {r.status === 'approved' && (
                    <button type="button" className="btn primary" style={{ padding: '3px 9px', fontSize: 12.5 }} disabled={busy}
                      onClick={() => act({ action: 'pick', id: r.id })}>Picked up</button>
                  )}
                  {['pending', 'approved'].includes(r.status) && (
                    <button type="button" className="btn" style={{ padding: '3px 9px', fontSize: 12.5, marginLeft: 6 }} disabled={busy}
                      onClick={() => act({ action: 'cancel_request', id: r.id })}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function Receive({ admin, onChanged, onOpen }) {
  const [f, setF] = useState({ partNumber: '', name: '', brand: '', category: '', fits: '', qty: '1', condition: 'new', location: '', cost: '', note: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'location' ? e.target.value.toUpperCase() : e.target.value });

  async function book() {
    if (!f.name.trim() && !f.partNumber.trim()) { setErr('Name the part, or give its number.'); return; }
    if (!(Number(f.qty) > 0)) { setErr('How many arrived?'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const { part } = await post({ action: 'add_part', partNumber: f.partNumber, name: f.name, brand: f.brand, category: f.category, fits: f.fits });
      await post({
        action: 'receive', partId: part.id, qty: Number(f.qty), condition: f.condition,
        location: f.location || undefined, cost: admin && f.cost ? Number(f.cost) : undefined, note: f.note
      });
      setMsg(`Booked in ${f.qty} × ${part.name}${part.existed ? ' (added to the ones we already had)' : ''}.`);
      setF({ ...f, partNumber: '', name: '', qty: '1', cost: '', note: '' });
      onChanged?.();
      onOpen(part.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Parts we bought, or a box that turned up. A part number we already have goes onto the same shelf
        record rather than making a second one.
      </p>
      {err && <div className="error-box">{err}</div>}
      {msg && <div className="notice-box">{msg}</div>}
      <div className="panel">
        <div className="pt-row">
          <input value={f.partNumber} onChange={set('partNumber')} placeholder="Part number" style={{ width: 160 }} aria-label="Part number" />
          <input value={f.name} onChange={set('name')} placeholder="What is it?" style={{ width: 220 }} aria-label="Name" />
          <input value={f.brand} onChange={set('brand')} placeholder="Brand" style={{ width: 120 }} aria-label="Brand" />
          <input value={f.category} onChange={set('category')} placeholder="Category" style={{ width: 130 }} aria-label="Category" />
        </div>
        <div className="pt-row" style={{ marginTop: 8 }}>
          <input value={f.fits} onChange={set('fits')} placeholder="Fits models (comma separated)" style={{ flex: '1 1 260px' }} aria-label="Fits" />
        </div>
        <div className="pt-row" style={{ marginTop: 8 }}>
          <input value={f.qty} onChange={set('qty')} inputMode="numeric" style={{ width: 80 }} aria-label="How many" />
          <select value={f.condition} onChange={set('condition')} style={{ width: 'auto' }}>
            {Object.entries(PART_CONDITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input value={f.location} onChange={set('location')} placeholder="Into spot" style={{ width: 130 }} aria-label="Spot" />
          {admin && <input value={f.cost} onChange={set('cost')} placeholder="Cost each $" style={{ width: 120 }} inputMode="decimal" aria-label="Cost each" />}
          <input value={f.note} onChange={set('note')} placeholder="Note (optional)" style={{ width: 180 }} aria-label="Note" />
          <button type="button" className="btn primary" disabled={busy} onClick={book}>Book it in</button>
        </div>
      </div>
    </div>
  );
}
