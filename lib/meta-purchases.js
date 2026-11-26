// Meta's Purchase event, sent only for website orders that have been PAID.
//
// Card payments are off, so an order is placed with no money attached. Counting
// it at checkout told Meta about sales that were later cancelled. Instead the
// checkout records the order here, and a cron sends the Purchase from the server
// once the order is paid, however that happened (mark paid, bank deposit match,
// status change on the board, store credit, card webhook).
import { hasDb, query } from './db';
import { capiReady, capiToken, capiUser, postMetaEvent } from './meta-capi';
import { isProduction } from './environment';
import { SITE_URL } from './site';

let ensured = null;
export async function ensureMetaPurchaseSchema() {
  if (!hasDb()) return;
  ensured ||= query(`CREATE TABLE IF NOT EXISTS meta_purchases (
      order_id   integer PRIMARY KEY,
      fbp        text,
      fbc        text,
      claimed_at timestamptz,
      sent_at    timestamptz,
      attempts   integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`).catch((e) => { ensured = null; throw e; });
  await ensured;
}

// Called by the online checkout. The pixel's cookies only exist on the shopper's
// own request, so they are kept now for the payment that comes later.
export async function recordWebOrderForMeta(orderId, req) {
  if (!hasDb() || !orderId) return;
  await ensureMetaPurchaseSchema();
  const cookie = (name) => req?.cookies?.get?.(name)?.value?.slice(0, 500) || null;
  await query(
    `INSERT INTO meta_purchases (order_id, fbp, fbc) VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, cookie('_fbp'), cookie('_fbc')]
  );
}

// "Paid": the order has moved past pending_payment and nothing on its invoice is
// still owing. A pay-in-person order can be marked ready before any money is
// taken, so it also needs a recorded payment, or to have been handed over.
const PAID_AND_UNSENT = `
  SELECT m.order_id, m.fbp, m.fbc, o.order_number, o.total, o.email, o.phone, o.ip, o.user_agent, o.created_at
    FROM meta_purchases m
    JOIN orders o ON o.id = m.order_id
   WHERE m.sent_at IS NULL
     AND m.created_at > now() - interval '30 days'
     AND o.status IN ('confirmed','ready','out_for_delivery','delivered')
     AND NOT EXISTS (SELECT 1 FROM invoices i
                      WHERE i.order_id = o.id AND i.status IN ('open','partial','refunded'))
     AND (COALESCE(o.payment_method, '') <> 'in_person'
          OR o.status = 'delivered'
          OR EXISTS (SELECT 1 FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
                      WHERE i.order_id = o.id AND p.amount > 0))
   ORDER BY m.order_id
   LIMIT 25`;

// Meta accepts an event up to 7 days old. The shopper decided when they placed
// the order, which is also what the ad's click window is measured against.
export function purchaseEventTime(placedAt, now = Date.now()) {
  const placed = new Date(placedAt).getTime();
  const recent = Number.isFinite(placed) && placed <= now && now - placed < 6.5 * 24 * 3600 * 1000;
  return Math.floor((recent ? placed : now) / 1000);
}

export async function sendPaidPurchases({ send = postMetaEvent, ready = capiReady() } = {}) {
  if (!hasDb()) return { skipped: 'no database', sent: 0, failed: [] };
  if (!ready) {
    // Silence here would look exactly like a shop with no sales.
    if (isProduction() && !capiToken()) return { sent: 0, failed: [], error: 'META_CAPI_ACCESS_TOKEN is not set' };
    return { skipped: 'not configured', sent: 0, failed: [] };
  }
  await ensureMetaPurchaseSchema();
  const { rows } = await query(PAID_AND_UNSENT);
  let sent = 0;
  const failed = [];
  for (const o of rows) {
    // Claim first, so two overlapping runs cannot both report one sale.
    const claim = await query(
      `UPDATE meta_purchases SET claimed_at = now(), attempts = attempts + 1
        WHERE order_id = $1 AND sent_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
        RETURNING order_id`,
      [o.order_id]
    );
    if (!claim.rows.length) continue;
    const { rows: lines } = await query(
      `SELECT sku FROM order_items
        WHERE order_id = $1 AND sku IS NOT NULL AND COALESCE(kind, 'unit') = 'unit'`,
      [o.order_id]
    );
    const ids = lines.map((l) => String(l.sku)).slice(0, 50);
    const r = await send({
      event_name: 'Purchase',
      event_time: purchaseEventTime(o.created_at),
      event_id: `purchase-${o.order_number}`,
      event_source_url: `${SITE_URL}/checkout`,
      action_source: 'website',
      user_data: capiUser({ ip: o.ip, userAgent: o.user_agent, fbp: o.fbp, fbc: o.fbc, email: o.email, phone: o.phone }),
      custom_data: { content_ids: ids, content_type: 'product', currency: 'CAD', value: Number(o.total) }
    });
    if (r.ok) {
      await query('UPDATE meta_purchases SET sent_at = now(), last_error = NULL WHERE order_id = $1', [o.order_id]);
      sent += 1;
    } else {
      await query('UPDATE meta_purchases SET claimed_at = NULL, last_error = $2 WHERE order_id = $1',
        [o.order_id, String(r.error || '').slice(0, 300)]);
      failed.push({ order: o.order_number, error: r.error });
    }
  }
  return { sent, failed };
}
