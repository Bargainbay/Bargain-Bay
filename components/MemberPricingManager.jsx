'use client';
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/constants';
import { toPercent, fromPercent, MEMBER_RATE_LABELS } from '../lib/member-rate-rules';

// One screen for what a reseller pays. The four numbers are typed as percentages; every change is
// previewed against the live stock BEFORE it is saved, through the same function checkout uses.
const FIELDS = [
  { key: 'regularRate', unit: '%', help: 'Share of the retail (strike-through) price. 55 means a member pays 55% of retail.' },
  { key: 'clearanceRate', unit: '%', help: 'Share of the clearance price. 90 means 10% off the markdown.' },
  { key: 'costFloor', unit: '%', help: 'A member never pays less than cost times this. 110 means cost + 10%.' },
  { key: 'minProfit', unit: '$', help: 'Where the unit has the room, we keep at least this much. 0 turns it off.' }
];
const show = (key, v) => (key === 'minProfit' ? String(v) : String(toPercent(v)));
const parse = (key, text) => (text === '' ? null : key === 'minProfit' ? Number(text) : fromPercent(text));

export default function MemberPricingManager({ initial }) {
  const [saved, setSaved] = useState(initial.rates);
  const [text, setText] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, initial.rates[f.key])])));
  const [preview, setPreview] = useState(initial.preview);
  const [q, setQ] = useState('');
  const [overrides, setOverrides] = useState(initial.overrides);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState('');
  const [hits, setHits] = useState([]);
  const [ovForm, setOvForm] = useState({ sku: '', price: '' });
  const seq = useRef(0);

  const draft = Object.fromEntries(FIELDS.map((f) => [f.key, parse(f.key, text[f.key])]));
  const dirty = FIELDS.some((f) => draft[f.key] !== null && draft[f.key] !== saved[f.key]);

  async function post(body) {
    const r = await fetch('/api/admin/member-pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  }

  // Re-run the preview as numbers or the search change. Latest request wins.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { ok, d } = await post({ action: 'preview', rates: draft, q });
      if (id !== seq.current) return;
      if (ok) { setPreview(d.preview); setErr(''); } else setErr(d.error || 'Could not preview.');
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q]);

  async function save(action) {
    setBusy(true); setErr(''); setNotice('');
    const { ok, d } = await post({ action, rates: draft });
    setBusy(false);
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setSaved(d.rates);
    setText(Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, d.rates[f.key])])));
    setPreview(d.preview);
    setNotice(action === 'reset_rates' ? 'Back to the standard rates. Members see it within a minute.' : 'Saved. Members see the new prices within a minute.');
  }

  async function searchSku(e) {
    e.preventDefault();
    const { ok, d } = await post({ action: 'search', q: find });
    if (ok) setHits(d.results || []);
  }
  async function overrideCall(body) {
    setErr(''); setNotice('');
    const { ok, d } = await post(body);
    if (!ok) { setErr(d.error || 'Could not save.'); return; }
    setOverrides(d.overrides);
    setNotice(body.action === 'set_override' ? `Member price set for ${body.sku}.` : `Override removed for ${body.sku}.`);
    if (body.action === 'set_override') setOvForm({ sku: '', price: '' });
  }

  const s = preview?.summary;
  const warn = s && (s.belowCost > 0 || s.belowMinProfit > 0);
  const input = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, width: 110 };

  return (
    <div>
      {err && <div className="error-box">{err}</div>}
      {notice && <div className="panel" style={{ color: '#0B6B3A', fontSize: 14 }}>{notice}</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Member rates</h2>
        <p className="hint">These apply to every approved member, to the whole shop, and at checkout. A member never pays less than the floor and never more than the public price — those two rules cannot be switched off.</p>
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
          <button className="btn primary" disabled={busy || !dirty || !!err} onClick={() => save('save_rates')}>{busy ? 'Saving…' : 'Save member rates'}</button>
          <button className="btn" disabled={busy || !dirty} onClick={() => setText(Object.fromEntries(FIELDS.map((f) => [f.key, show(f.key, saved[f.key])])))}>Undo changes</button>
          <button className="btn" disabled={busy} onClick={() => { if (confirm('Put all four rates back to the standard 55% / 90% / cost + 10% / $200?')) save('reset_rates'); }}>Reset to standard</button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>What this does to the shop</h2>
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check a unit: SKU, brand or model (blank shows a spread of prices)" style={{ ...input, width: '100%', maxWidth: 460, marginBottom: 10 }} />
        <div className="table-wrap"><table className="admin">
          <thead><tr><th>Unit</th><th>Retail</th><th>Public</th><th>Member now</th><th>Member with these rates</th><th>We keep</th></tr></thead>
          <tbody>{(preview?.rows || []).map((r) => (
            <tr key={r.sku}>
              <td style={{ fontSize: 13 }}><b>{r.title}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>{r.sku}{r.onClearance ? ' · clearance' : ''}{r.override != null ? ' · typed price' : ''}</div></td>
              <td>{r.retail ? money(r.retail) : '—'}</td>
              <td>{money(r.public)}</td>
              <td>{money(r.memberNow)}</td>
              <td><b>{money(r.memberNext)}</b>{r.memberNext !== r.memberNow && <span style={{ fontSize: 12, color: 'var(--muted)' }}> (was {money(r.memberNow)})</span>}</td>
              <td style={{ color: r.marginNext != null && r.marginNext < 0 ? '#b00020' : undefined }}>{r.marginNext == null ? 'no cost' : money(r.marginNext)}</td>
            </tr>))}
            {(preview?.rows || []).length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No units match.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>A specific price for one unit</h2>
        <p className="hint">Use this when one unit should sell to members at a number the rates would not give. It is still held between the floor and the public price. Remove it and the unit goes back to the rates above.</p>
        <form onSubmit={searchSku} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a unit by SKU, brand or model" style={{ ...input, width: 300 }} />
          <button className="btn">Find</button>
        </form>
        {hits.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 10 }}><table className="admin"><tbody>{hits.map((h) => (
            <tr key={h.sku}><td style={{ fontSize: 13 }}><b>{h.title}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>{h.sku} · public {money(h.price)}{h.retail ? ` · retail ${money(h.retail)}` : ''}</div></td>
              <td><button className="btn" type="button" onClick={() => { setOvForm({ sku: h.sku, price: '' }); setHits([]); }}>Set a member price</button></td></tr>))}
          </tbody></table></div>
        )}
        {ovForm.sku && (
          <form onSubmit={(e) => { e.preventDefault(); overrideCall({ action: 'set_override', ...ovForm }); }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <b>{ovForm.sku}</b> member price $
            <input style={input} inputMode="decimal" value={ovForm.price} onChange={(e) => setOvForm((f) => ({ ...f, price: e.target.value }))} autoFocus />
            <button className="btn primary">Save</button>
            <button className="btn" type="button" onClick={() => setOvForm({ sku: '', price: '' })}>Cancel</button>
          </form>
        )}
        {overrides.length === 0 ? <p className="hint" style={{ margin: 0 }}>No typed prices. (The older June price table still applies to the SKUs it names.)</p> : (
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Unit</th><th>Member price</th><th>Public now</th><th></th></tr></thead>
            <tbody>{overrides.map((o) => (
              <tr key={o.sku}>
                <td style={{ fontSize: 13 }}><b>{o.title || 'Not on the site any more'}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>{o.sku}</div></td>
                <td>{money(o.price)}</td>
                <td>{o.publicPrice != null ? money(o.publicPrice) : '—'}</td>
                <td><button className="btn danger" type="button" onClick={() => overrideCall({ action: 'remove_override', sku: o.sku })}>Remove</button></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
