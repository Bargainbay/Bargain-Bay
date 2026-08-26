'use client';
import { isCreditLine, isUnitLine } from '../lib/constants';
import { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice } from '../lib/invoice-lines';

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

export default function InvoiceLines({ items, setItems, showCost = false, services = [] }) {
  const setItem = (i, k, v) => setItems((xs) => xs.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
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
        <div key={i} className="inv-line">
          <input className="inv-desc" value={it.description}
            onChange={(e) => setItem(i, 'description', e.target.value)}
            autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false}
            placeholder={PLACEHOLDER[it.kind] || PLACEHOLDER.unit} />
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

export { blankItem, serviceItem, creditItem, subtotalOf, goodsOf, toPayload, fromInvoice };
