// Abandoned carts: who added a unit and did not buy, so staff can ring them.
//
// STAFF TO-DO LIST. Nothing in THIS file emails or texts a customer, and nothing
// here touches consent (lib/consent.js). Typing an email into checkout is not an
// express yes to marketing. The customer reminder sequence lives in
// lib/abandoned-cart-emails.js and goes through filterAudience.
//
// A cart is recorded only once the shopper is identifiable (signed in, or an
// email/phone typed on /checkout). Anonymous carts are never stored.
//
// Every read degrades OPEN to "nothing": a failed lookup must never break the
// dashboard or a checkout.
import { hasDb, query } from './db';
import { phoneKey } from './constants';
import { upsertCustomer } from './customers';
import { addTask } from './crm';

export const DEFAULT_QUIET_HOURS = 4;
// Past this a cart is history, not a lead.
export const MAX_AGE_DAYS = 14;
export const TASK_PREFIX = 'Abandoned cart';

const clean = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/**
 * Record the cart as the browser sees it. `skus: []` closes it.
 * Returns { stored: bool }. Never throws.
 */
export async function recordCart({ token, skus, email, phone, name, userId } = {}) {
  if (!hasDb()) return { stored: false };
  try {
    const tok = clean(token, 80);
    if (!tok || !/^[A-Za-z0-9_-]{8,80}$/.test(tok)) return { stored: false };
    const list = [...new Set((Array.isArray(skus) ? skus : []).filter((s) => typeof s === 'string' && s.length <= 80))].slice(0, 30);
    const mail = clean(email, 200)?.toLowerCase();
    const em = mail && validEmail(mail) ? mail : null;
    const key = phoneKey(phone);

    const { rows: existing } = await query(`SELECT id, closed_at, email, phone_key FROM cart_sessions WHERE token = $1`, [tok]);
    if (!em && !key && !existing.length) return { stored: false };   // anonymous: nothing to keep

    if (!existing.length) {
      if (!list.length) return { stored: false };
      await query(
        `INSERT INTO cart_sessions (token, email, phone, phone_key, name, user_id, skus)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (token) DO NOTHING`,
        [tok, em, clean(phone, 40), key, clean(name), Number(userId) || null, list]
      );
      return { stored: true };
    }
    if (!list.length) {
      await query(`UPDATE cart_sessions SET skus = '{}', closed_at = COALESCE(closed_at, now()), updated_at = now() WHERE token = $1`, [tok]);
      return { stored: true };
    }
    // Same browser, cart that was closed and is filling again → a NEW cart:
    // reset the clock and the follow-up marker so it can be raised afresh.
    await query(
      `UPDATE cart_sessions SET
          skus = $2,
          email = COALESCE($3, email), phone = COALESCE($4, phone), phone_key = COALESCE($5, phone_key),
          name = COALESCE($6, name), user_id = COALESCE($7, user_id),
          created_at = CASE WHEN closed_at IS NOT NULL THEN now() ELSE created_at END,
          tasked_at  = CASE WHEN closed_at IS NOT NULL THEN NULL ELSE tasked_at END,
          notified_at = CASE WHEN closed_at IS NOT NULL THEN NULL ELSE notified_at END,
          generation = CASE WHEN closed_at IS NOT NULL THEN generation + 1 ELSE generation END,
          closed_at = NULL,
          updated_at = now()
        WHERE token = $1`,
      [tok, list, em, clean(phone, 40), key, clean(name), Number(userId) || null]
    );
    return { stored: true };
  } catch (e) {
    console.error('recordCart failed (ignored):', e.message);
    return { stored: false };
  }
}

// The cart's owner has since bought something: an order for their email or
// phone placed after the cart began. Derived at read time so it holds however
// the order was placed (website, invoice, phone) and needs no hook in checkout.
const BOUGHT = `EXISTS (
  SELECT 1 FROM orders o
   WHERE o.status <> 'cancelled' AND o.created_at >= c.created_at
     AND ((c.email IS NOT NULL AND lower(o.email) = c.email)
       OR (c.phone_key IS NOT NULL AND o.phone IS NOT NULL
           AND right(regexp_replace(o.phone, '\\D', '', 'g'), 10) = right(c.phone_key, 10)))
)`;

/**
 * Open carts untouched for `hours`, newest first, with the state of each unit.
 * unit.state: available | sold | held | gone.
 */
export async function abandonedCarts({ hours = DEFAULT_QUIET_HOURS, limit = 100 } = {}) {
  if (!hasDb()) return [];
  const h = Math.min(Math.max(Number(hours) || DEFAULT_QUIET_HOURS, 0), 24 * MAX_AGE_DAYS);
  try {
    const { rows: carts } = await query(
      `SELECT c.id, c.email, c.phone, c.name, c.skus, c.created_at, c.updated_at, c.tasked_at, c.customer_id, c.notified_at, c.generation,
              extract(epoch FROM (now() - c.updated_at)) / 3600.0 AS age_hours
         FROM cart_sessions c
        WHERE c.closed_at IS NULL AND cardinality(c.skus) > 0
          AND c.updated_at <= now() - ($1::numeric * interval '1 hour')
          AND c.updated_at >= now() - ($2::int * interval '1 day')
          AND NOT ${BOUGHT}
        ORDER BY c.updated_at DESC LIMIT $3`,
      [h, MAX_AGE_DAYS, Math.min(Math.max(Number(limit) || 100, 1), 300)]
    );
    if (!carts.length) return [];
    const all = [...new Set(carts.flatMap((c) => c.skus))];
    const { rows: prods } = await query(
      `SELECT p.sku, p.title, p.active, p.sold_at,
              COALESCE(cl.price, p.price) AS price
         FROM products p LEFT JOIN clearance cl ON cl.sku = p.sku AND cl.active
        WHERE p.sku = ANY($1)`, [all]
    ).catch(() => ({ rows: [] }));
    const { rows: gone } = await query(
      `SELECT DISTINCT oi.sku FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.sku = ANY($1) AND o.status NOT IN ('cancelled','pending_payment','refunded')`, [all]
    ).catch(() => ({ rows: [] }));
    const { rows: held } = await query(
      `SELECT sku FROM reservations WHERE sku = ANY($1) AND expires_at > now()`, [all]
    ).catch(() => ({ rows: [] }));
    const byId = new Map(prods.map((p) => [p.sku, p]));
    const soldSet = new Set(gone.map((r) => r.sku));
    const heldSet = new Set(held.map((r) => r.sku));

    return carts.map((c) => {
      const units = c.skus.map((sku) => {
        const p = byId.get(sku);
        let state = 'available';
        if (soldSet.has(sku) || p?.sold_at) state = 'sold';
        else if (heldSet.has(sku)) state = 'held';
        else if (!p || !p.active) state = 'gone';
        return { sku, title: p?.title || sku, price: p?.price == null ? null : Number(p.price), state };
      });
      const open = units.filter((u) => u.state === 'available');
      return {
        id: c.id, email: c.email, phone: c.phone, name: c.name,
        customerId: c.customer_id, taskedAt: c.tasked_at,
        notifiedAt: c.notified_at, generation: c.generation, ageHours: Number(c.age_hours),
        updatedAt: c.updated_at,
        units,
        // What is still worth chasing: units nobody else has taken.
        availableCount: open.length,
        availableTotal: Math.round(open.reduce((a, u) => a + (u.price || 0), 0) * 100) / 100
      };
    });
  } catch (e) {
    console.error('abandonedCarts failed (treating as none):', e.message);
    return [];
  }
}

/**
 * Raise ONE unassigned CRM follow-up per customer who left a cart with
 * something still for sale. Deduped three ways: a cart is raised once
 * (tasked_at), a customer with an OPEN abandoned-cart task gets no second one
 * however many carts or devices they have, and a cart with nothing left to buy
 * raises nothing.
 */
export async function raiseAbandonedCartTasks({ hours = DEFAULT_QUIET_HOURS } = {}) {
  const out = { raised: 0, skipped: 0 };
  if (!hasDb()) return out;
  const carts = await abandonedCarts({ hours, limit: 300 });
  for (const c of carts) {
    try {
      if (c.taskedAt) { out.skipped++; continue; }
      if (!c.availableCount) { out.skipped++; continue; }
      const customerId = await upsertCustomer({ email: c.email, name: c.name, phone: c.phone });
      if (!customerId) { out.skipped++; continue; }
      const { rows: open } = await query(
        `SELECT 1 FROM customer_tasks WHERE customer_id = $1 AND done_at IS NULL AND title LIKE $2 LIMIT 1`,
        [customerId, `${TASK_PREFIX}%`]
      );
      if (!open.length) {
        const list = c.units.filter((u) => u.state === 'available').map((u) => `${u.title} (${u.sku})`).join('; ');
        await addTask({
          customerId,
          title: `${TASK_PREFIX}: ${c.availableCount} unit${c.availableCount === 1 ? '' : 's'}, $${c.availableTotal.toFixed(2)}`,
          note: `Left in their cart and did not check out: ${list}. Reach out by phone or personal email only — no automated messages.`,
          dueOn: null,
          ownerEmail: null,           // unassigned: My Day shows it to everyone
          createdBy: 'system:abandoned-cart'
        });
        out.raised++;
      } else out.skipped++;
      await query(`UPDATE cart_sessions SET tasked_at = now(), customer_id = $2 WHERE id = $1`, [c.id, customerId]);
    } catch (e) {
      console.error('abandoned cart task failed (continuing):', e.message);
    }
  }
  return out;
}
