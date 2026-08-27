'use client';
import { splitTaxInclusive } from '../lib/tax';

// How the amounts in the line boxes should be read.
//
//   exclusive — what they've always meant: the price before tax, HST added on top
//   inclusive — "twelve hundred out the door". The system backs the tax out and
//               the total lands on the figure that was quoted
//
// Switching between them CONVERTS what's already typed, so it's a way of reading
// the boxes rather than a thing you have to remember to set first. The stored
// invoice is identical either way: line amounts are always pre-tax.
//
// Every sale here carries HST, so there is no "no tax" choice. But zero-HST
// invoices DO exist — the salvage screen raises parts-only sales without it —
// and one of those must not silently gain 13% just because somebody reopened it
// and hit save. So `none` is still a state an invoice can BE in; it just isn't
// one you can pick, and the moment a real mode is chosen the option is gone.
export const TAX_MODES = {
  exclusive: 'Prices are before tax — add 13% HST',
  inclusive: 'Prices include 13% HST — back it out'
};
export const NO_TAX = 'none';
const NO_TAX_LABEL = 'No HST — as this invoice was raised';

export const modeOf = (addHst, taxInclusive) => (!addHst ? NO_TAX : (taxInclusive ? 'inclusive' : 'exclusive'));

// What the invoice will come to, in the terms the boxes are currently in.
// `amounts` are signed (a credit line is negative), exactly as the lines are.
export function previewTotals(amounts, mode) {
  const nums = (amounts || []).map((n) => Number(n) || 0);
  const sum = Math.round(nums.reduce((a, n) => a + n, 0) * 100) / 100;
  if (mode === NO_TAX) return { subtotal: sum, hst: 0, total: sum, quoted: sum, residual: 0 };
  if (mode === 'inclusive') return splitTaxInclusive(nums);
  const hst = Math.round(sum * 13) / 100;
  return { subtotal: sum, hst, total: Math.round((sum + hst) * 100) / 100, quoted: sum, residual: 0 };
}

export default function TaxMode({ mode, onChange, preview }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
      <label htmlFor="inv-taxmode">Tax</label>
      <select id="inv-taxmode" value={mode} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
        {Object.entries(TAX_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        {/* Only ever offered to an invoice that already has no HST on it, so the
            select can show its own value. Choosing either real mode retires it. */}
        {mode === NO_TAX && <option value={NO_TAX}>{NO_TAX_LABEL}</option>}
      </select>
      {mode === 'inclusive' && (
        <span className="hint" style={{ margin: 0 }}>
          Type what the customer pays. The invoice still shows the tax separately — it has to.
          {/* One cent-value in eight has no exact 13% split. Saying so beats the
              rep spotting a penny they can't explain in front of a customer. */}
          {preview && Math.abs(preview.residual) >= 0.005 && (
            <b style={{ color: 'var(--charcoal)' }}>
              {' '}${Math.abs(preview.quoted).toFixed(2)} can&apos;t be split exactly at 13% — this invoice comes to $
              {preview.total.toFixed(2)}.
            </b>
          )}
        </span>
      )}
    </div>
  );
}
