'use client';
import { isCreditLine, isUnitLine } from '../lib/constants';
import { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice, stockLineProblem } from '../lib/invoice-lines';

// The line-item editor shared by the invoice FORM (new) and the invoice EDITOR
// (existing). It was copy-pasted between the two, which is how they drifted —
// and four kinds of line is more than a duplicated block can carry. The sign
// convention it relies on lives in lib/invoice-lines.js.
const TAG = { service: 'Service', discount: '− Discount', trade_in: '− Trade-in' };
const PLACEHOLDER = {
  unit: 'e.g. Whirlpool WRS321SDHZ refrigerator',
  service: 'Service description',
  discount: 'What the discount is for',
  trade_in: 'Their old unit — make, model, condition'
};

// Every query word must appear somewhere in the unit's text, so "kitchenaid
// dishwasher" matches with the brand and the type far apart in the string.
function searchStock(stock, q, exclude) {
  const tokens = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length || String(q).trim().length < 2) return [];
  return stock.filter((u) => !exclude.has(u.id) && tokens.every((t) => u.search.includes(t))).slice(0, 8);
}

export default function InvoiceLines({ items, setItems, showCost = false, services = [], stock = [] }) {
  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const patchItem = (i, patch) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  // A unit already on another line can't be picked twice.
  const onLines = new Set(items.map((it) => it.sku).filter(Boolean));
  const pick = (i, u) => patchItem(i, {
    sku: u.id, description: u.description, q: '', offStock: false, offStockReason: null,
    // Keep a price the rep already typed; otherwise take the list price when there is one.
    amount: String(items[i]?.amount || '') || (u.price > 0 ? String(u.price) : '')
  });
  const addRow = () => setItems((xs) => [...xs, blankItem()]);
  const removeRow = (i) => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs));

  // Reuse the first empty row rather than always appending — the form starts
  // with one, and every quick-add would otherwise leave a blank above it.
  const push = (li) => setItems((xs) => {
    const empty = xs.findIndex((it) => !it.description && !it.amount);
    return empty >= 0 ? xs.map((it, j) => (j === empty ? li : it)) : [...xs, li];
  });

  const goods = goodsOf(items);
  // A percentage is snapshotted to dollars the moment it's added: an invoice
  // line is a figure, and re-deriving it later would silently move a total
  // somebody has already quoted out loud.
  const addPercent = (pct) => push(creditItem('discount', `Discount (${pct}%)`,
    goods > 0 ? (Math.round(goods * pct) / 100).toFixed(2) : ''));

  const hasTradeIn = items.some((it) => it.kind === 'trade_in');

  return (
    <>
      <label style={{ fontSize: 13, fontWeight: 500, display: 'block', margin: '4px 0 6px' }}>Line items</label>
      {items.map((it, i) => (
        <div key={i} style={{ marginBottom: 2 }}>
        <div className="inv-line">
          {isUnitLine(it.kind) && !it.sku && !it.legacy && !it.offStock ? (
            // An appliance is PICKED, never typed: the line gets its SKU from here, which
            // is what lets the sale mark the unit sold. See lib/stock-reconcile.js.
            <input className="inv-desc" value={it.q || ''}
              onChange={(e) => setItem(i, 'q', e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              placeholder="Find the appliance in stock — model, brand, SKU or serial…" />
          ) : (
            <input className="inv-desc" value={it.description}
              onChange={(e) => setItem(i, 'description', e.target.value)}
              autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false}
              placeholder={PLACEHOLDER[it.kind] || PLACEHOLDER.unit} />
          )}
          {isUnitLine(it.kind) ? (
            <select className="inv-warr" value={it.warrantyMonths == null ? '' : it.warrantyMonths}
              onChange={(e) => setItem(i, 'warrantyMonths', e.target.value === '' ? null : Number(e.target.value))}
              title="Warranty term shown on the invoice">
              <option value={24}>2-yr warranty</option>
              <option value={12}>1-yr warranty</option>
              <option value={6}>6-mo warranty</option>
              <option value={3}>3-mo warranty</option>
              <option value="">No warranty</option>
            </select>
          ) : (
            <span className={'pill inv-tag' + (isCreditLine(it.kind) ? ' is-credit' : '')}>{TAG[it.kind]}</span>
          )}
          {isUnitLine(it.kind) && !it.sku && showCost && (
            <input className="inv-cost" type="number" inputMode="decimal" min="0" step="0.01"
              value={it.cost ?? ''} onChange={(e) => setItem(i, 'cost', e.target.value)}
              placeholder="cost" title="Your cost for this unit (for margin) — fill in for a unit that isn't in inventory" />
          )}
          <input className="inv-amt" type="number" inputMode="decimal" min="0" step="0.01"
            value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)}
            placeholder={isCreditLine(it.kind) ? 'amount off' : 'price'}
            aria-label={isCreditLine(it.kind) ? 'Amount to take off' : 'Price'} />
          <button type="button" className="btn inv-del" onClick={() => removeRow(i)} aria-label="Remove line">×</button>
        </div>

        {isUnitLine(it.kind) && it.sku && (
          <div className="hint" style={{ margin: '-4px 0 8px' }}>
            From stock: <b style={{ fontFamily: 'monospace' }}>{it.sku}</b>
            {!it.id && <> · <button type="button" className="linkish" style={{ background: 'none', border: 0, padding: 0, color: 'var(--link, #0a58ca)', cursor: 'pointer', fontSize: 'inherit' }}
              onClick={() => patchItem(i, { sku: null, description: '', q: '' })}>pick a different unit</button></>}
          </div>
        )}
        {isUnitLine(it.kind) && it.legacy && (
          <div className="hint" style={{ margin: '-4px 0 8px' }}>
            Typed before appliances were picked from stock — tie it to its unit on <a href="/admin/inventory-gaps">Stock gaps</a>.
          </div>
        )}
        {isUnitLine(it.kind) && !it.sku && !it.legacy && !it.offStock && (
          <div style={{ margin: '-4px 0 8px' }}>
            {searchStock(stock, it.q, onLines).map((u) => (
              <button type="button" key={u.id} onClick={() => pick(i, u)}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '7px 10px', background: 'var(--card, #fff)', border: '1px solid var(--line)', borderTop: 0, cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                <span>{u.description}<span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{u.status}</span></span>
                <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>{u.price > 0 ? `$${u.price.toFixed(2)}` : 'no list price'}</span>
              </button>
            ))}
            {String(it.q || '').trim().length >= 2 && !searchStock(stock, it.q, onLines).length && (
              <div className="hint" style={{ margin: '4px 0' }}>Nothing in stock matches “{it.q}”. If it&apos;s on the tracker under another spelling, try the SKU or serial.</div>
            )}
            <button type="button" style={{ background: 'none', border: 0, padding: 0, marginTop: 4, color: 'var(--muted)', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' }}
              onClick={() => patchItem(i, { offStock: true, description: it.q || '', q: '' })}>
              Not from our stock?
            </button>
          </div>
        )}
        {isUnitLine(it.kind) && !it.sku && !it.legacy && it.offStock && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '-4px 0 8px' }}>
            <input style={{ flex: '1 1 260px' }} value={it.offStockReason || ''}
              onChange={(e) => setItem(i, 'offStockReason', e.target.value)}
              placeholder="Why isn't this from our stock? e.g. special order from supplier" />
            <button type="button" className="btn" style={{ fontSize: 12.5 }}
              onClick={() => patchItem(i, { offStock: false, offStockReason: null, q: it.description, description: '' })}>
              Pick from stock instead
            </button>
            <span className="hint" style={{ margin: 0, flexBasis: '100%' }}>
              It will be listed on Stock gaps every day until it is tied to a unit — nothing on the tracker is marked sold by it.
            </span>
          </div>
        )}
        </div>
      ))}

      {hasTradeIn && (
        <div className="hint" style={{ margin: '2px 0 8px' }}>
          The delivery team is told to bring the trade-in unit back to the warehouse — it shows on the
          dispatch board, the run sheet and the driver&apos;s stop, and the driver has to confirm it&apos;s on the van.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" className="btn" onClick={addRow}>+ Add line</button>
        {services.length > 0 && <span className="hint" style={{ margin: '0 0 0 4px' }}>Add a service:</span>}
        {services.map((sv) => (
          <button key={sv} type="button" className="btn" style={{ fontSize: 12.5 }}
            onClick={() => push(serviceItem(sv))}>+ {sv}</button>
        ))}
        <span className="hint" style={{ margin: '0 0 0 4px' }}>Take money off:</span>
        <button type="button" className="btn" style={{ fontSize: 12.5 }}
          onClick={() => push(creditItem('discount', 'Discount'))}>+ Discount</button>
        {[5, 10, 15].map((pct) => (
          <button key={pct} type="button" className="btn" style={{ fontSize: 12.5 }}
            title={goods > 0 ? `${pct}% of $${goods.toFixed(2)}` : 'Add the items first'}
            onClick={() => addPercent(pct)}>{pct}%</button>
        ))}
        <button type="button" className="btn" style={{ fontSize: 12.5 }}
          title="We're taking their old appliance in part-exchange — the delivery team is told to collect it"
          onClick={() => push(creditItem('trade_in', ''))}>+ Trade-in</button>
      </div>
    </>
  );
}

export { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice, stockLineProblem };
