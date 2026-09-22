// The sign convention for invoice / order lines, and the two boundaries where
// it is applied.
//
// A discount or a trade-in is TYPED as a plain positive number ("take fifty off")
// and STORED negative, so a document's subtotal is always just SUM(amount) and
// nothing downstream has to reason about signs. The flip happens here and only
// here — `toPayload` on the way out of a form, `fromInvoice` on the way back in
// — which is what stops an edit from negating the same line twice.
import { LINE_KINDS, isCreditLine, isUnitLine, normalizeLineKind } from './constants';
import { offStockReasonProblem } from './stock-match';

// A new appliance line starts EMPTY and unpicked: it gets its description, SKU
// and price by choosing a unit from stock (see InvoiceLines), or it is marked
// "not from our stock" with a reason. Typing an appliance in by hand is how sales
// stopped reaching the inventory.
export const blankItem = () => ({ description: '', amount: '', kind: 'unit', warrantyMonths: 12, cost: '', sku: null });

// What's wrong with the lines as far as stock goes, for the forms to say before
// submitting. The server checks the same rule (stockRuleProblem) and more.
export function stockLineProblem(items) {
  for (const it of items || []) {
    if (!isUnitLine(it.kind) || it.sku || it.legacy) continue;
    const typed = String(it.description || '').trim() || Number(it.amount) > 0;
    if (!typed) continue;
    // A reason saved before the list existed stands as it was; a new one must be
    // one of the list (the server checks the same thing).
    if (it.offStock && it.offStockReason !== it.savedReason) {
      const why = offStockReasonProblem(it.offStockReason);
      if (why) return `“${String(it.description || 'that appliance').trim()}”: ${why}`;
    }
    if (!it.offStock) {
      return `Pick “${String(it.description || 'the appliance').trim()}” from stock — or mark it "not from our stock" and say why.`;
    }
  }
  return '';
}
export const serviceItem = (description) => ({ description, amount: '', kind: 'service', warrantyMonths: null });
export const creditItem = (kind, description = '', amount = '') =>
  ({ description, amount: amount === '' ? '' : String(amount), kind, warrantyMonths: null });

// What the customer is charged, with credits taken off. Mirrors the server's own
// subtotal so a preview and the saved document can't disagree.
export function subtotalOf(items) {
  return (items || []).reduce((a, it) => {
    const n = Number(it.amount) || 0;
    return a + (isCreditLine(it.kind) ? -Math.abs(n) : n);
  }, 0);
}

// Just the charged side — what a percentage discount is a percentage OF.
export function goodsOf(items) {
  return (items || []).reduce((a, it) => (isCreditLine(it.kind) ? a : a + (Number(it.amount) || 0)), 0);
}

// Form rows → API payload. Credits go out negative.
export function toPayload(items) {
  return (items || []).map((it) => (isCreditLine(it.kind)
    ? { ...it, amount: -Math.abs(Number(it.amount) || 0) }
    : it));
}

// Stored items → form rows. Credits come back as the positive number the person
// typed, so re-saving an untouched document changes nothing.
//
// `typed_amount` is the figure keyed on a tax-inclusive invoice and is preferred
// over `amount` when it's there, because only it can be shown back exactly.
// `amount` is pre-tax, and grossing it up doesn't reliably return what was typed:
// the tax-in split parks a rounding cent on the largest line, so a $750 washer
// came back as $749.99. `typedAmount` rides along so a caller can tell a row that
// knows what was typed from one that's only a derivation.
export function fromInvoice(items) {
  return (items || []).map((it) => {
    const kind = LINE_KINDS[it.kind] ? it.kind : 'unit';
    const typed = it.typed_amount ?? it.typedAmount ?? null;
    const shown = typed == null ? it.amount : typed;
    const amount = shown == null ? '' : String(isCreditLine(kind) ? Math.abs(Number(shown)) : shown);
    return {
      description: it.description || '',
      amount,
      sku: it.sku || null,
      kind,
      warrantyMonths: isUnitLine(kind) ? (it.warranty_months ?? it.warrantyMonths ?? 12) : null,
      typedAmount: typed == null ? null : Number(typed),
      offStockReason: it.off_stock_reason ?? it.offStockReason ?? null,
      // Reopened as what it is — a line marked not-from-stock — rather than as an
      // empty stock search the editor would then refuse to save.
      offStock: isUnitLine(kind) && !it.sku && !!(it.off_stock_reason ?? it.offStockReason),
      savedReason: it.off_stock_reason ?? it.offStockReason ?? null,
      // An appliance line saved before lines had to be picked from stock: no SKU
      // and no reason. It stays editable as text so an old sale can still be
      // corrected; the stock-gaps page is where it gets tied to its unit.
      legacy: isUnitLine(kind) && !it.sku && !(it.off_stock_reason ?? it.offStockReason)
    };
  });
}

// The share of a document's value that a credit takes off each charged line. An
// invoice carrying a discount or a trade-in charged LESS than its charged lines
// add up to, so refunding a line at face value returns money nobody ever paid.
// Returns 1 when there are no credits, which is the everyday case.
export function creditFactorOf(items) {
  const charged = (items || []).filter((it) => !isCreditLine(it.kind))
    .reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const credited = Math.abs((items || []).filter((it) => isCreditLine(it.kind))
    .reduce((a, it) => a + (Number(it.amount) || 0), 0));
  if (!(charged > 0)) return 1;
  return Math.max(0, Math.min(1, Math.round((charged - credited) / charged * 10000) / 10000));
}

export { normalizeLineKind, isCreditLine, isUnitLine };
