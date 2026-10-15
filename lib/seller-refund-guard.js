// A refund on an invoice that carries a marketplace SELLER's unit has to be booked the seller's way.
//
// The ledger credits Sales and HST only with OUR part of such an invoice and holds the seller's part in
// 2160 (owed to marketplace vendors). A refund booked the ordinary way debits Sales and HST for money
// that was never credited to them, and leaves 2160 still owing the seller for goods the customer sent
// back — wrong in both directions, and silently, which is why this refuses instead of guessing.
//
// The rule is the one the seller-cancellation path already follows: a refund of a seller's line carries
// VENDOR_REFUND_REASON, which the ledger reads as "draw down what we owe the seller", and ONLY seller
// lines are refunded under it. Our own lines on the same invoice are refunded separately.
import { query } from './db';
import { VENDOR_REFUND_REASON } from './marketplace-rules';

export const isSellerSku = (sku) => /^MP-/i.test(String(sku || ''));

/**
 * Returns a message when the refund must not go ahead, else null. Degrades OPEN if the marketplace
 * table cannot be read: an invoice with no seller on it must never be blocked by a marketplace problem.
 *   targetSkus: the SKUs being refunded line by line, or null for a whole-invoice / money-only refund.
 */
export async function sellerRefundProblem(invoiceId, { targetSkus = null, reason = '' } = {}) {
  let live;
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM vendor_orders vo JOIN invoices i ON i.order_id = vo.order_id
        WHERE i.id = $1 AND vo.status <> 'cancelled'`, [invoiceId]);
    live = rows[0]?.n || 0;
  } catch { return null; }
  if (!live) return null;
  const viaReason = `Use the reason "${VENDOR_REFUND_REASON}", then record the amount against the seller (Admin → Marketplace → Vendors → Take money off this seller).`;
  if (targetSkus == null) {
    return 'This invoice includes a marketplace seller\'s unit, so a whole-invoice or money-only refund cannot say whose money it is. '
      + 'Refund the lines one at a time: our own lines normally, the seller\'s unit under its own refund.';
  }
  const seller = targetSkus.filter(isSellerSku);
  if (!seller.length) return null;                                        // only our own lines: ordinary refund
  if (seller.length !== targetSkus.length) {
    return 'Refund the seller\'s unit and our own lines separately — they are booked differently (the seller\'s comes off what we owe them).';
  }
  if (String(reason || '').trim() !== VENDOR_REFUND_REASON) {
    return `That line is a marketplace seller's unit. ${viaReason}`;
  }
  return null;
}
