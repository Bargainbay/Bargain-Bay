'use client';
import { useEffect, useMemo, useState } from 'react';
import { quoteProfit, profitLabel } from '../lib/quote-profit';

// Live profit on a quote, for the owner and the business-development rep only (the
// page decides whether to render it; the cost route refuses anyone else again).
//
// Services are added one of two ways. CHARGED puts a line on the quote the customer pays
// (its price in revenue, its internal cost off). INCLUDED shows nothing to the customer;
// only its internal cost comes off. A yellow/red line is a warning and never blocks.
const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE = { ok: 'var(--ok, #1a7f4b)', low: '#b7791f', loss: 'var(--red, #c33)' };

export default function ProfitPanel({ items, bundlePct, cashDeal, addHst, freeDelivery, services = [], threshold = 100, setServiceLine }) {
  const [costs, setCosts] = useState({});
  const [picked, setPicked] = useState({}); // serviceId -> { mode, qty }
  const skuKey = items.map((i) => i.sku).filter(Boolean).join('|');

  useEffect(() => {
    const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
    if (!skus.length) { setCosts({}); return; }
    let live = true;
    fetch('/api/sales/profit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skus }) })
      .then((r) => (r.ok ? r.json() : { costs: {} })).then((d) => { if (live) setCosts(d.costs || {}); }).catch(() => {});
    return () => { live = false; };
  }, [skuKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  function choose(id, patch) {
    const next = { ...(picked[id] || { mode: 'included', qty: 1 }), ...patch };
    setPicked({ ...picked, [id]: next });
    const s = byId.get(id);
    if (next.mode === 'charged') setServiceLine(id, { description: s.name, amount: String(((s.defaultPrice || 0) * (next.qty || 1)).toFixed(2)) });
    else setServiceLine(id, null);
  }
  function drop(id) {
    const { [id]: _gone, ...rest } = picked; setPicked(rest); setServiceLine(id, null);
  }

  const chosen = Object.entries(picked).map(([id, p]) => ({ ...byId.get(Number(id)), id: Number(id), ...p })).filter((s) => s.name);
  // "Include free delivery" on the quote IS an included delivery — count its cost
  // unless a delivery service has been picked here.
  const hasDelivery = chosen.some((s) => /^delivery/i.test(s.name));
  const implicit = freeDelivery && !hasDelivery ? services.find((s) => /^delivery/i.test(s.name)) : null;

  const lines = items.map((it) => ({
    amount: Number(it.amount) || 0,
    cost: it.serviceId ? null : (it.sku ? (costs[String(it.sku).toUpperCase()] ?? null) : null),
    isUnit: !it.serviceId && !!(it.sku || it.description?.trim() || Number(it.amount) > 0)
  })).filter((l) => l.amount > 0 || l.isUnit);

  const svc = [
    // Charged services are already lines above (their price is in revenue), so only their COST counts here.
    ...chosen.map((s) => ({ mode: s.mode, price: 0, internalCost: s.internalCost, costBasis: s.costBasis, qty: s.qty, name: s.name })),
    ...(implicit ? [{ mode: 'included', price: 0, internalCost: implicit.internalCost, costBasis: implicit.costBasis, qty: 1, name: `${implicit.name} (free delivery on quote)` }] : [])
  ];
  const cash = Number(cashDeal) > 0 ? Number(cashDeal) : null;
  const p = quoteProfit({ lines, services: svc, bundlePct, cashTotal: cash, addHst, threshold });

  return (
    <div className="panel" style={{ borderLeft: `4px solid ${TONE[p.level]}`, background: 'var(--panel-alt, #fafafa)' }} aria-live="polite">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b style={{ fontSize: 15 }}>Profit on this quote <span className="hint" style={{ fontWeight: 400 }}>(only you can see this)</span></b>
        <span style={{ fontSize: 22, fontWeight: 800, color: TONE[p.level] }}>{profitLabel(p)}</span>
      </div>
      <div style={{ fontSize: 13.5, margin: '6px 0' }}>
        Revenue {fmt(p.revenue)} − units {fmt(p.unitCost)} − services {fmt(p.serviceCost)}
        {p.marginPct != null && <> · margin {p.marginPct}%</>}
      </div>
      {p.missing.units > 0 && <div className="hint" style={{ color: '#b7791f' }}>{p.missing.units} line{p.missing.units === 1 ? '' : 's'} with no cost on file — counted as $0, so the real profit is lower.</div>}
      {p.missing.services > 0 && <div className="hint" style={{ color: '#b7791f' }}>{p.missing.services} service{p.missing.services === 1 ? '' : 's'} with no internal cost set — counted as $0.</div>}

      <details style={{ marginTop: 8 }} open={chosen.length > 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13.5 }}>Services</summary>
        {services.length === 0 && <p className="hint">No services set up yet. The owner adds them under Service prices.</p>}
        {chosen.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 13.5 }}>
            <b style={{ flex: '1 1 160px' }}>{s.name}</b>
            <select value={s.mode} onChange={(e) => choose(s.id, { mode: e.target.value })} aria-label={`${s.name}: charged or included`}>
              <option value="included">Included (free)</option><option value="charged">Charged</option>
            </select>
            <input type="number" min="1" value={s.qty} style={{ width: 60 }} aria-label={`${s.name} quantity`}
              onChange={(e) => choose(s.id, { qty: Math.max(1, Number(e.target.value) || 1) })} />
            <span className="hint">cost {s.internalCost == null ? 'not set' : fmt(s.internalCost)} {s.costBasis === 'unit' ? 'per unit' : s.costBasis === 'hour' ? 'per hour' : s.costBasis === 'appliance' ? 'per appliance' : 'per order'}</span>
            <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => drop(s.id)}>Remove</button>
          </div>
        ))}
        {services.filter((s) => !picked[s.id]).length > 0 && (
          <select value="" onChange={(e) => e.target.value && choose(Number(e.target.value), { mode: 'included', qty: 1 })} aria-label="Add a service" style={{ marginTop: 6 }}>
            <option value="">+ Add a service (Delivery, Install, Haul-away…)</option>
            {services.filter((s) => !picked[s.id]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </details>
    </div>
  );
}
