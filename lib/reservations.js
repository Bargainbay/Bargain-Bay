// Reservation / availability layer on Postgres.
// Every unit is one-of-a-kind (qty 1), so "available" means:
//   - not on any order whose status is past pending_payment and not cancelled, AND
//   - no active (unexpired) reservation row.
// Orders stuck in pending_payment free their units automatically when the
// 30-minute reservation expires, so abandoned checkouts never strand stock.
import { query, hasDb } from './db';
import { sendOrderStatusEmail } from './email';
import { voidWebInvoicesForOrders } from './web-invoices';
import { releaseCouponForOrder } from './coupons';
import { ensureAbuseSchema } from './antifraud';
import { VERIFY_WINDOW_HOURS } from './order-verify';

export const RESERVATION_MINUTES = 30;
// Offline orders (e-transfer / pay-on-pickup) aren't abandoned the way an
// unfinished card checkout is, so they hold their unit longer than 30 minutes.
// This was 60 days, which — with card payments off, so EVERY order is offline —
// meant one junk order took a sellable one-of-a-kind unit off the storefront for
// two months. 7 days is a full week for a real e-transfer to land (reminded by
// email on day 5), after which the order self-cancels and the unit relists.
export const OFFLINE_HOLD_DAYS = Number(process.env.UNPAID_ORDER_DAYS || 7);
export const OFFLINE_HOLD_MINUTES = OFFLINE_HOLD_DAYS * 24 * 60;

// Set of SKUs that are NOT purchasable right now.
// Degrades gracefully: with no database configured everything reads available.
export async function unavailableSkus(skus = null) {
  if (!hasDb()) return new Set();
  try {
    const params = [];
    let skuAnd = '';
    if (skus && skus.length) {
      params.push(skus);
      skuAnd = 'AND oi.sku = ANY($1)';
    }
    const sold = await query(
      `SELECT DISTINCT oi.sku
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status NOT IN ('cancelled','pending_payment','refunded') ${skuAnd}`,
      params
    );
    const reserved = await query(
      `SELECT sku FROM reservations
        WHERE expires_at > now() ${skus && skus.length ? 'AND sku = ANY($1)' : ''}`,
      params
    );
    return new Set([...sold.rows, ...reserved.rows].map((r) => r.sku));
  } catch (e) {
    console.error('unavailableSkus failed (treating all as available):', e.message);
    return new Set();
  }
}

export async function isUnavailable(sku) {
  const set = await unavailableSkus([sku]);
  return set.has(sku);
}

// Atomically reserve a list of SKUs for an order inside an existing
// transaction (pass the pg client from withTransaction). Each SKU is claimed
// with a single race-safe statement: the upsert only steals an existing row
// when it has expired; concurrent inserts on the same PK serialize, so the
// loser's WHERE clause fails and we throw → the whole transaction rolls back.
export async function reserveWithClient(client, skus, orderId, minutes = RESERVATION_MINUTES) {
  for (const sku of skus) {
    const res = await client.query(
      `INSERT INTO reservations (sku, order_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
       ON CONFLICT (sku) DO UPDATE
         SET order_id = EXCLUDED.order_id, expires_at = EXCLUDED.expires_at
         WHERE reservations.expires_at < now()
       RETURNING sku`,
      [sku, orderId, String(minutes)]
    );
    if (res.rowCount === 0) {
      const err = new Error(`Unit ${sku} is currently held by another checkout`);
      err.code = 'SKU_HELD';
      err.sku = sku;
      throw err;
    }
  }
}

// Free reservations (e.g. order cancelled or Stripe session failed to start).
export async function releaseForOrder(orderId) {
  if (!hasDb()) return;
  await query('DELETE FROM reservations WHERE order_id = $1', [orderId]);
}

// Housekeeping: drop expired reservation rows (they no longer block anything,
// this is hygiene) and cancel pending_payment orders older than 24h so
// abandoned checkouts don't pile up. Called by /api/cron/expire-reservations
// and opportunistically (fire-and-forget) from /api/checkout.
export async function expireReservations() {
  if (!hasDb()) return { expiredReservations: 0, cancelledOrders: 0 };
  // The unverified-order clock below reads verify_token/verified_at, so make
  // sure those columns exist even if nobody has run the admin migration yet.
  await ensureAbuseSchema();
  const expired = await query(
    `DELETE FROM reservations r
      WHERE r.expires_at < now()
        AND (r.order_id IS NULL OR EXISTS (
              SELECT 1 FROM orders o
               WHERE o.id = r.order_id AND o.status IN ('pending_payment','cancelled')))
      RETURNING r.sku`
  );
  // Auto-cancel genuinely abandoned unpaid orders. Three separate clocks:
  //
  //  a) CARD orders after 24h — an unfinished card checkout is abandoned, and
  //     this is the original rule.
  //  b) OFFLINE orders (e-transfer / pay-in-person) after OFFLINE_HOLD_DAYS.
  //     These legitimately settle later than 24h — the owner marks them
  //     confirmed when the money lands — so they used to be excluded entirely.
  //     With card payments off that exclusion meant NOTHING ever released a
  //     junk order's unit. A week is long enough for a real e-transfer.
  //     DELIBERATELY scoped to orders created after this feature shipped, which
  //     are exactly the ones carrying a verify_token or a verified_at stamp.
  //     Without that guard the first run would cancel every historical unpaid
  //     order at once and email all of them — including genuine slow payers the
  //     owner is still waiting on. Pre-existing junk is cleared by hand from the
  //     order board or in one click via the blocklist.
  //  c) UNVERIFIED orders after VERIFY_WINDOW_HOURS — nobody clicked the "yes,
  //     this is really me" link, so the email address behind the order is not
  //     reachable. Only applies to orders that were actually issued a token
  //     (verify_token IS NOT NULL), so orders placed before this shipped, and
  //     logged-in customers' auto-verified orders, are never swept.
  //
  // All three free the held unit and email the customer an apology.
  const cancelled = await query(
    `UPDATE orders o SET status = 'cancelled'
      WHERE o.status = 'pending_payment'
        AND (
          (COALESCE(o.payment_method,'') NOT IN ('etransfer','in_person')
             AND o.created_at < now() - interval '24 hours')
          OR (COALESCE(o.payment_method,'') IN ('etransfer','in_person')
             AND (o.verify_token IS NOT NULL OR o.verified_at IS NOT NULL)
             AND o.created_at < now() - ($1 || ' days')::interval)
          OR (o.verify_token IS NOT NULL AND o.verified_at IS NULL
             AND o.created_at < now() - ($2 || ' hours')::interval)
        )
        -- ...and never an order raised by a MANUAL invoice. Those sit in
        -- pending_payment on purpose while the balance is collected (a deposit
        -- now, the rest on delivery), carry no payment_method until they settle,
        -- and would otherwise all be cancelled a day after being written —
        -- taking the sale off the dashboard and relisting a unit the customer
        -- has already put money on. The owner voids or refunds these by hand.
        --
        -- This guard now matters MORE, not less, than when it was written:
        -- clock (b) above sweeps offline orders after a week, and a deposit sale
        -- IS an offline order sitting in pending_payment for exactly that long.
        --
        -- A 'web' invoice must NOT grant that protection. Every storefront
        -- checkout now gets one, so shielding on "has an invoice" would stop this
        -- sweep dead and let abandoned card checkouts hold their unit forever.
        -- The web invoice mirrors its order, so cancelling the order voids it.
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
           WHERE i.order_id = o.id AND COALESCE(i.channel, 'manual') <> 'web')
      RETURNING o.id, o.order_number, o.name, o.email, o.delivery_method, o.total`,
    [String(OFFLINE_HOLD_DAYS), String(VERIFY_WINDOW_HOURS)]
  );
  if (cancelled.rowCount) {
    const ids = cancelled.rows.map((r) => r.id);
    await query('DELETE FROM reservations WHERE order_id = ANY($1)', [ids]);
    // Void the storefront invoice behind each cancelled order, so an abandoned
    // checkout stops showing as an open receivable the moment it's cancelled.
    await voidWebInvoicesForOrders(ids);
    // Hand the promo code back. A checkout nobody finished must not burn a use
    // of an affiliate's limited-run code. (An order a HUMAN cancels keeps its
    // redemption — that was a real order — and simply reports no revenue.)
    for (const id of ids) await releaseCouponForOrder(id);
    for (const o of cancelled.rows) {
      sendOrderStatusEmail({ ...o, status: 'cancelled' }, [])
        .catch((e) => console.error('auto-cancel email failed', o.order_number, e.message));
    }
  }
  return { expiredReservations: expired.rowCount, cancelledOrders: cancelled.rowCount };
}
