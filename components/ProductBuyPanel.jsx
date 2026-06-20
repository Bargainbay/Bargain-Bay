'use client';
import { useState } from 'react';
import { money, pctOff, PICKUP_ADDRESS } from '../lib/constants';
import ConditionPill from './ConditionPill';
import AddToCartButton from './AddToCartButton';

// Buy panel for a model that may have several identical in-stock units.
// `units` is every available unit of the same make+model (cheapest first),
// each already decorated for this viewer. Picking a unit swaps the photo,
// price, condition and Add-to-Cart live — no page reload — and rewrites the
// URL to the chosen unit so the page stays shareable/bookmarkable.
export default function ProductBuyPanel({ units, initialId }) {
  const [id, setId] = useState(initialId);
  const sel = units.find((u) => u.id === id) || units[0];
  const multi = units.length > 1;
  const off = pctOff(sel.price, sel.compareAt);
  const name = sel.title || `${sel.make} ${sel.model}`;

  function choose(u) {
    setId(u.id);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', `/product/${encodeURIComponent(u.id)}`);
    }
  }

  return (
    <div className="product-layout">
      <div className="product-img">
        {sel.onClearance && <span className="clearance-badge product-clearance-badge">Clearance</span>}
        <img src={sel.image} alt={name} />
      </div>
      <div>
        <ConditionPill condition={sel.condition} />
        {sel.onClearance && <span className="pill clearance-pill" style={{ marginLeft: 8 }}>Clearance</span>}
        {sel.sold && <span className="pill sold" style={{ marginLeft: 8 }}>Sold / on hold</span>}
        <h1 style={{ margin: '10px 0 4px' }}>{name}</h1>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>{sel.category} · {sel.make}</div>

        <div className="price-row" style={{ margin: '14px 0 4px' }}>
          <span className={'product-price' + (sel.onClearance ? ' price-clearance' : '')}>{money(sel.price)}</span>
          {sel.compareAt > sel.price && <span className="compare" style={{ fontSize: 16 }}>{money(sel.compareAt)}</span>}
        </div>
        {off > 0 && <div className="savings">You save {money(sel.compareAt - sel.price)} ({off}% off retail)</div>}
        {sel.isMemberPrice && <div className="member-was">Member price · client price {money(sel.clientPrice)}</div>}
        <div className="hint">+ 13% HST at checkout · prices in CAD</div>

        <div className="cond-box"><b>{sel.condition}:</b> {sel.explainer}</div>

        <div className="meta-list">
          <div>Model #: <b style={{ color: 'var(--ink)' }}>{sel.model}</b></div>
          <div>SKU: {sel.id}</div>
          {multi
            ? <div>⚡ <b style={{ color: 'var(--ink)' }}>{units.length} of this model available</b> — each a separate, individually-tested unit. Pick yours below.</div>
            : <div>⚡ <b style={{ color: 'var(--ink)' }}>One available</b> — every Bargain Bay unit is one-of-a-kind. When it&apos;s gone, it&apos;s gone.</div>}
        </div>

        {multi && (
          <div className="unit-picker">
            <div className="unit-picker-head">Choose your unit — {units.length} available</div>
            <div className="unit-options" role="radiogroup" aria-label="Choose your unit">
              {units.map((u) => {
                const uoff = pctOff(u.price, u.compareAt);
                const active = u.id === sel.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={'unit-option' + (active ? ' active' : '')}
                    onClick={() => choose(u)}
                    disabled={u.sold}
                  >
                    <span className="unit-radio" aria-hidden="true" />
                    <span className="unit-option-main">
                      <ConditionPill condition={u.condition} />
                      <span className="unit-option-sku">SKU {u.id}{u.sold ? ' · sold' : ''}</span>
                    </span>
                    <span className="unit-option-price">
                      <span className="price">{money(u.price)}</span>
                      {uoff > 0 && <span className="unit-option-off">{uoff}% off</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ maxWidth: 360, marginTop: 14 }}>
          <AddToCartButton sku={sel.id} available={!sel.sold} price={sel.price} name={name} />
        </div>

        <div className="meta-list" style={{ marginTop: 18 }}>
          <div>🚚 Free pickup at {PICKUP_ADDRESS} (by appointment), flat-fee local delivery, or freight — Hamilton, Scarborough &amp; the GTA.</div>
          <div>✔️ Bench-tested &amp; certified working before listing.</div>
          <div>📄 <a href="/policies/returns" style={{ textDecoration: 'underline' }}>Returns &amp; one-year warranty</a></div>
        </div>

        <a className="btn" href="/shop" style={{ marginTop: 18 }}>← Back to catalogue</a>
      </div>
    </div>
  );
}
