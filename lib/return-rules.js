// The returns rules (owner, 2026-11-27). NO IMPORTS: the product page, checkout and the invoice
// screens run this in the browser, and the server runs the same code when it stamps a sale and when
// somebody tries to refund one.
//
//   · Anything sold for MORE than 30% off retail is final sale: no returns, refunds or exchanges.
//   · Every refund keeps a 20% restocking fee.
//   · Dead on arrival: reported within 24 hours of pickup or delivery, eligible for EXCHANGE
//     (final-sale units included).
//
// DATED ON PURPOSE. A sale made before RETURN_RULES_FROM was made under the old terms and keeps
// them: its invoice still prints them and nothing here blocks its refund.

export const RETURN_RULES_FROM = '2026-11-27T20:25:00Z';
export const RETURN_RULES_DATE_WORDS = 'November 27, 2026';

export const FINAL_SALE_OVER_PCT = 30;
export const DOA_REPORT_HOURS = 24;
export const CHANGE_OF_MIND_DAYS = 14;
export const REFUND_FEE_PCT = 20;

export const FINAL_SALE_LABEL = 'Final sale — no returns, refunds or exchanges';

/** The policy in a few lines, for the AI agents' instructions. */
export const returnsPolicyBrief = () => [
  `- Anything sold for more than ${FINAL_SALE_OVER_PCT}% off retail is FINAL SALE: no returns, refunds or exchanges. So is anything marked Final Sale or As-Is.`,
  `- All refunds are subject to a ${REFUND_FEE_PCT}% restocking fee.`,
  `- Dead on arrival (final sale included) must be reported within ${DOA_REPORT_HOURS} hours of pickup or delivery, and is eligible for EXCHANGE, not a cash refund. After that it is a warranty claim (repair or replace).`,
  `- Damage, missing parts or a wrong item must be reported within ${DOA_REPORT_HOURS} hours.`,
  `- Items ${FINAL_SALE_OVER_PCT}% off or less: change-of-mind return within ${CHANGE_OF_MIND_DAYS} days, uninstalled and unused, less the fee and return transport. Deposits are non-refundable.`,
  '- Full policy: bargainbay.ca/policies/returns'
].join('\n');

/** Does a sale made at this moment fall under these rules? No date = being made now. */
export function returnRulesApply(at = null) {
  const t = at ? new Date(at).getTime() : Date.now();
  return Number.isFinite(t) ? t >= new Date(RETURN_RULES_FROM).getTime() : true;
}

/**
 * Sold for MORE than 30% off retail. Both figures are before tax. Exactly 30% off is not final.
 * With no retail price on record there is nothing to measure against, so it is not flagged.
 */
export function isFinalSale(price, retail) {
  const p = Math.round(Number(price) * 100);
  const r = Math.round(Number(retail) * 100);
  if (!(p > 0) || !(r > 0)) return false;
  return p * 100 < r * (100 - FINAL_SALE_OVER_PCT);
}

/**
 * The share of each appliance's price the customer actually pays once DISCOUNTS are spread over the
 * appliances: "sold for" means after a promo code or a discount line. A trade-in is payment in kind,
 * not a discount, and a service charge is not part of a unit's price. Lines are { amount, kind }.
 */
export function discountFactor(lines = []) {
  let charged = 0;
  let off = 0;
  for (const l of lines || []) {
    const a = Number(l?.amount) || 0;
    if (l?.kind === 'trade_in') continue;
    if (a < 0) off += -a;
    else if (!l?.kind || l.kind === 'unit') charged += a;
  }
  return charged > 0 ? Math.max(0, Math.min(1, (charged - off) / charged)) : 1;
}

/**
 * Stamp `finalSale` and `retailPrice` on appliance lines, IN PLACE.
 * `retailBySku` is a Map keyed on the UPPERCASED sku.
 */
export function stampFinalSale(lines = [], retailBySku = new Map()) {
  const factor = discountFactor(lines);
  for (const l of lines) {
    const unit = !l.kind || l.kind === 'unit';
    const retail = unit && l.sku ? Number(retailBySku.get(String(l.sku).trim().toUpperCase())) || 0 : 0;
    l.retailPrice = retail > 0 ? retail : null;
    l.finalSale = unit && isFinalSale((Number(l.amount) || 0) * factor, retail);
  }
  return lines;
}

/**
 * Why this refund is outside the published policy, as a sentence, or null when it is inside it.
 * Only an admin may go ahead anyway (our own mistake, a legal obligation).
 *
 *   sale      — { createdAt, status, refundTotal }
 *   targets   — the lines being refunded, [{ finalSale }] (null for a money-only refund)
 *   allLines  — every line on the invoice
 *   amount    — money-only refunds: what is being given back
 *   collected — money-only refunds: what has been taken on the invoice
 */
export function refundPolicyProblem({ sale, targets = null, allLines = [], restockingPct = 0, amount = null, collected = 0, asCredit = false, delivered = false }) {
  if (!returnRulesApply(sale?.createdAt)) return null;
  if (targets) {
    if (targets.some((t) => t.finalSale)) {
      return `This is a final sale item (more than ${FINAL_SALE_OVER_PCT}% off retail): no refund or exchange. Dead on arrival, reported within ${DOA_REPORT_HOURS} hours, is exchanged, not refunded.`;
    }
    if ((Number(restockingPct) || 0) < REFUND_FEE_PCT) {
      return `Every refund keeps a ${REFUND_FEE_PCT}% restocking fee. Tick "Keep a restocking fee" at ${REFUND_FEE_PCT}% or more.`;
    }
    return null;
  }
  // Money only. The most that can go back is what was collected less the fee, counting what already has.
  const max = Math.round((Number(collected) || 0) * (100 - REFUND_FEE_PCT)) / 100;
  const total = (Number(amount) || 0) + (Number(sale?.refundTotal) || 0);
  if (total > max + 0.005) {
    return `Every refund keeps a ${REFUND_FEE_PCT}% restocking fee: no more than $${max.toFixed(2)} in total can go back on this invoice.`;
  }
  // A cancellation before the goods leave comes back as store credit; that stays open for any sale.
  if ((allLines || []).some((l) => l.finalSale) && (!asCredit || delivered)) {
    return 'This invoice has a final sale item. Money can only go back as store credit on a cancellation before pickup or delivery.';
  }
  return null;
}
