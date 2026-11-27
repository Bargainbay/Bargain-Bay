// The server half of the returns rules: reads the invoice and asks lib/return-rules.js whether a
// refund is inside the published policy. Called by the refund screen, the refund API and Sarah's
// refund tool. The refund functions themselves are unchanged, so internal reversals (a seller who
// could not fulfil) are not stopped by a customer-facing rule.
import { query } from './db';
import { isCreditLine } from './constants';
import { markFinalSale } from './final-sale';
import { refundPolicyProblem, returnRulesApply } from './return-rules';

/** The invoice as the rules see it: when it was sold, what is on it, what was taken, did it leave. */
export async function refundFacts(invoiceId) {
  const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  const inv = rows[0];
  if (!inv) return null;
  const { rows: raw } = await query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id', [invoiceId]);
  const lines = raw.map((r) => ({
    id: r.id, sku: r.sku, kind: r.kind || 'unit', amount: Number(r.amount) || 0,
    refunded: !!r.refunded_at, finalSale: !!r.final_sale, retailPrice: r.retail_price
  }));
  // A line tied to its unit after the sale was written has never been judged: judge it now.
  if (returnRulesApply(inv.created_at) && lines.some((l) => l.sku && l.kind === 'unit' && l.retailPrice == null)) {
    const judged = lines.map((l) => ({ ...l }));
    await markFinalSale(judged, { at: inv.created_at });
    judged.forEach((j, i) => { if (lines[i].retailPrice == null) lines[i].finalSale = !!j.finalSale; });
  }
  let collected = 0;
  try {
    const { rows: p } = await query('SELECT COALESCE(SUM(amount),0) AS n FROM invoice_payments WHERE invoice_id = $1', [invoiceId]);
    collected = Number(p[0]?.n) || 0;
  } catch { /* the table provisions on first payment */ }
  if (inv.status === 'paid') collected = Math.max(collected, Number(inv.total) || 0);
  let delivered = false;
  if (inv.order_id) {
    const { rows: o } = await query('SELECT * FROM orders WHERE id = $1', [inv.order_id]);
    delivered = !!o[0] && (o[0].status === 'delivered' || !!o[0].delivered_at);
  }
  return { sale: { createdAt: inv.created_at, status: inv.status, refundTotal: Number(inv.refund_total) || 0 }, lines, collected, delivered };
}

/**
 * Why this refund breaks the policy, or null.
 * kind: 'full' | 'items' (itemIds and/or skus) | 'amount'.
 */
export async function refundGuard(invoiceId, { kind, itemIds = [], skus = [], restockingPct = 0, amount = 0, asCredit = false }) {
  const f = await refundFacts(invoiceId);
  if (!f) return null; // the refund function reports a missing invoice itself
  const charged = f.lines.filter((l) => !isCreditLine(l.kind) && !l.refunded);
  if (kind === 'amount') {
    return refundPolicyProblem({ sale: f.sale, allLines: f.lines.filter((l) => !l.refunded), amount, collected: f.collected, asCredit, delivered: f.delivered });
  }
  const ids = new Set((itemIds || []).map(Number));
  const wanted = new Set((skus || []).map((s) => String(s).trim().toLowerCase()));
  const targets = kind === 'full' ? charged
    : charged.filter((l) => ids.has(l.id) || (l.sku && wanted.has(String(l.sku).toLowerCase())));
  return refundPolicyProblem({ sale: f.sale, targets, allLines: f.lines, restockingPct });
}
