// Email confirmation for offline (unpaid) orders.
//
// With card payments off, an order costs the person placing it nothing and
// proves nothing — but it still reserves a one-of-a-kind unit. This adds the
// cheapest possible proof that a real, reachable person is behind the order:
// they click a link in the email we send them.
//
// The unit IS held the moment the order is placed (owner's call) so a genuine
// buyer never loses their appliance while they go find the email. If the link
// isn't clicked inside VERIFY_WINDOW_HOURS, the sweep in lib/reservations.js
// cancels the order and relists the unit.
import { randomBytes, timingSafeEqual } from 'crypto';
import { query, hasDb } from './db';
import { sendEmail, esc } from './email';
import { SITE_URL } from './site';

// How long an unverified order may hold its unit. Deliberately generous enough
// to survive "ordered at 11pm, read email at 8am" — a real customer must not
// lose a one-of-a-kind unit overnight. Fake orders still drop from the 60-day
// offline hold to this window, which is the whole point.
export const VERIFY_WINDOW_HOURS = Number(process.env.ORDER_VERIFY_HOURS || 12);

export function newVerifyToken() {
  return randomBytes(32).toString('hex');
}

export function verifyUrl(token) {
  const base = (SITE_URL || 'https://bargainbay.ca').replace(/\/$/, '');
  return `${base}/api/orders/verify?token=${encodeURIComponent(token)}`;
}

// Look the order up by token and stamp it verified. Constant-time compare on
// the token so the lookup can't be probed byte-by-byte for a valid value.
// Returns the order row, or null when the token is unknown or malformed.
export async function verifyOrderByToken(token) {
  if (!hasDb()) return null;
  const t = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const { rows } = await query(
    'SELECT id, order_number, email, verify_token, verified_at, status FROM orders WHERE verify_token = $1',
    [t]
  );
  const order = rows[0];
  if (!order || !order.verify_token) return null;
  const a = Buffer.from(order.verify_token);
  const b = Buffer.from(t);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Cancelled orders can't be revived by clicking an old link — the owner (or
  // the sweep) already released the unit and it may have sold to someone else.
  if (order.status === 'cancelled') return { ...order, alreadyCancelled: true };
  if (order.verified_at) return order; // idempotent: clicking twice is fine
  await query('UPDATE orders SET verified_at = now() WHERE id = $1', [order.id]);
  return { ...order, verified_at: new Date() };
}

export async function sendOrderVerifyEmail({ to, name, orderNumber, token, items = [] }) {
  const first = (name || '').split(' ')[0] || 'there';
  const url = verifyUrl(token);
  const lines = items.map((i) => `<li>${esc(i.title)}</li>`).join('');
  return sendEmail({
    to,
    subject: `Confirm your Bargain Bay order ${orderNumber}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
      <h2 style="text-transform:uppercase;letter-spacing:.05em">One quick tap</h2>
      <p>Hi ${esc(first)} — thanks for your order <b>${esc(orderNumber)}</b>. Please confirm it's really you so we can keep holding your unit.</p>
      ${lines ? `<ul style="padding-left:18px">${lines}</ul>` : ''}
      <p style="margin:22px 0"><a href="${url}" style="background:#2e2d2b;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:700">Confirm my order</a></p>
      <p style="font-size:13px;color:#666">Everything we sell is one of a kind, so we can only hold it for ${VERIFY_WINDOW_HOURS} hours without this confirmation. After that the appliance goes back on the site for someone else.</p>
      <p style="font-size:13px;color:#666">If you didn't place this order, just ignore this email — nothing happens and the hold drops automatically.</p>
    </div>`
  });
}
