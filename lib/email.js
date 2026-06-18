// Transactional email via Resend. Degrades to a logged no-op when
// RESEND_API_KEY is unset, so the site (and signups) work with or without it.
import { money, PICKUP_ADDRESS, SALES_EMAIL, ETRANSFER_EMAIL } from './constants';
import { SITE_URL } from './site';

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

const FROM = () => process.env.RESEND_FROM || 'Bargain Bay <onboarding@resend.dev>';
const NOTIFY = () => process.env.NOTIFY_EMAIL || 'bargain.bay.save@gmail.com';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEmail({ to, subject, html }) {
  if (!emailConfigured()) {
    console.log('[email skipped — RESEND_API_KEY not set]', subject);
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY not set' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      // reply_to points at the monitored inbox (SALES_EMAIL) so a customer
      // reply lands somewhere real even though `from` is the verified domain.
      body: JSON.stringify({ from: FROM(), to: [to || NOTIFY()], reply_to: SALES_EMAIL, subject, html })
    });
    const text = await r.text().catch(() => '');
    if (!r.ok) {
      console.error('resend send failed', r.status, text);
      return { ok: false, status: r.status, error: text.slice(0, 300) };
    }
    let id = null;
    try { id = JSON.parse(text).id; } catch {}
    return { ok: true, status: r.status, id };
  } catch (e) {
    console.error('resend error', e.message);
    return { ok: false, error: e.message };
  }
}

// Notify the store owner. Fire-and-forget at call sites (don't block the response).
export async function notifyOwner(subject, html) {
  return sendEmail({ to: NOTIFY(), subject, html });
}

// Tell an approved reseller they now have member pricing (fulfils the
// "we'll email you once approved" promise shown on the membership form).
export async function sendMemberApproved({ to, name, businessName }) {
  const first = (name || '').split(' ')[0] || 'there';
  return sendEmail({
    to,
    subject: "You're approved for Bargain Bay member pricing",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
      <h2 style="text-transform:uppercase;letter-spacing:.05em">You're in, ${esc(first)}</h2>
      <p>${businessName ? esc(businessName) + ' is' : 'Your account is'} now approved for <b>Bargain Bay member (wholesale) pricing</b>.</p>
      <p>Just <a href="${SITE_URL}/login">log in</a> and your member price shows on every unit automatically — no code needed.</p>
      <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)}.</p>
    </div>`
  });
}

// ---- Order emails --------------------------------------------------------
// Sent when an order is confirmed (pay-on-pickup) or paid (Stripe webhook).
// `order` carries: orderNumber, name, email, deliveryMethod, address, city,
// postal, subtotal, hst, total. `items` is [{ title, price }, ...].

function itemRows(items) {
  return (items || [])
    .map((it) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.title)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(it.price)}</td>
    </tr>`)
    .join('');
}

function fulfilmentLine(order) {
  if (order.deliveryMethod === 'delivery') {
    const addr = [order.address, order.city, order.postal].filter(Boolean).join(', ');
    return `Local delivery to ${esc(addr) || 'the address on file'} — our team will reach out to schedule.`;
  }
  return `Free warehouse pickup at ${esc(PICKUP_ADDRESS)} — reply to this email to arrange a time.`;
}

// Payment instructions for the customer while online card checkout is off.
// e-transfer → how to send it; in_person → pay on pickup/delivery.
function paymentBox(order) {
  const collectAt = order.deliveryMethod === 'delivery' ? 'when we deliver' : 'when you pick up';
  if (order.paymentMethod === 'in_person') {
    return `<div style="border:1px solid #e3c34d;background:#fffbe9;border-radius:8px;padding:12px 14px;margin:14px 0">
      <b>Payment due ${esc(collectAt)}</b><br/>
      Pay by cash, debit, or credit card in person — total <b>${money(order.total)}</b>.
      Your ${order.deliveryMethod === 'delivery' ? 'unit is reserved' : 'unit is held'} for you in the meantime.
    </div>`;
  }
  return `<div style="border:1px solid #e3c34d;background:#fffbe9;border-radius:8px;padding:12px 14px;margin:14px 0">
    <b>Payment due — Interac e-Transfer</b><br/>
    Send <b>${money(order.total)}</b> to <b>${esc(ETRANSFER_EMAIL)}</b> (auto-deposit — no security question needed).
    Put your order number <b>${esc(order.orderNumber)}</b> in the message so we can match it.
    We'll hold your ${'unit'} and confirm your order as soon as it arrives. Prefer to pay in person?
    You can also pay by cash, debit, or card ${esc(collectAt)}.
  </div>`;
}

function orderEmailHtml(order, items, { forOwner }) {
  const heading = forOwner
    ? `New order ${esc(order.orderNumber)}`
    : `Thanks, ${esc((order.name || '').split(' ')[0] || 'there')} — we've got your order`;
  const intro = forOwner
    ? `A new order just came in on Bargain Bay${order.paymentMethod === 'in_person' ? ' (paying in person)' : order.paymentMethod === 'etransfer' ? ' (paying by e-transfer)' : ''}.`
    : `We've reserved your ${items.length === 1 ? 'unit' : 'units'}. One more step — payment — and we'll schedule your ${order.deliveryMethod === 'delivery' ? 'delivery' : 'pickup'}.`;
  // Owner doesn't need the customer-facing payment box; customers do.
  const payBox = forOwner ? '' : paymentBox(order);
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">${heading}</h2>
    <p>${intro}</p>
    <p><b>Order:</b> ${esc(order.orderNumber)}<br/>
       <b>Customer:</b> ${esc(order.name)} (${esc(order.email)})</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${itemRows(items)}
      <tr><td style="padding:6px 0;text-align:right">Subtotal</td><td style="padding:6px 0;text-align:right">${money(order.subtotal)}</td></tr>
      <tr><td style="padding:6px 0;text-align:right">HST (13%)</td><td style="padding:6px 0;text-align:right">${money(order.hst)}</td></tr>
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(order.total)}</td></tr>
    </table>
    ${payBox}
    <p>${fulfilmentLine(order)}</p>
    <p style="font-size:13px;color:#666">Track this order any time: <a href="${SITE_URL}/order/${encodeURIComponent(order.orderNumber)}">${SITE_URL}/order/${esc(order.orderNumber)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your order number.</p>
  </div>`;
}

// Send both the customer receipt and the owner alert. Best-effort and guarded:
// returns a no-op result without throwing so it never blocks an order.
export async function sendOrderEmails(order, items) {
  try {
    const tasks = [
      sendEmail({
        to: order.email,
        subject: `We got your Bargain Bay order ${order.orderNumber} — payment due`,
        html: orderEmailHtml(order, items, { forOwner: false })
      }),
      notifyOwner(
        `🛒 New order ${order.orderNumber} — ${money(order.total)} (${order.name})`,
        orderEmailHtml(order, items, { forOwner: true })
      )
    ];
    const [customer, owner] = await Promise.all(tasks);
    return { customer, owner };
  } catch (e) {
    console.error('sendOrderEmails failed', e.message);
    return { ok: false };
  }
}
