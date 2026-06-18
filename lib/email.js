// Transactional email via Resend. Degrades to a logged no-op when
// RESEND_API_KEY is unset, so the site (and signups) work with or without it.
import { money, PICKUP_ADDRESS, SALES_EMAIL, CUSTOMER_SERVICE_EMAIL, ETRANSFER_EMAIL, REVIEW_URL } from './constants';
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
    We'll hold your unit for 24 hours and confirm as soon as payment is applied. Orders with non payment will
    automatically be cancelled after 24 hours.
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

// ---- Invoice email -------------------------------------------------------
// Itemized invoice with Interac e-transfer instructions. `invoice` carries:
// number, name, email, subtotal, hst, total, memo, dueDate, items[{description, amount}].
function invoiceRows(items) {
  return (items || [])
    .map((it) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.description)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(it.amount)}</td>
    </tr>`)
    .join('');
}

export async function sendInvoiceEmail(invoice) {
  const due = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const first = (invoice.name || '').split(' ')[0] || 'there';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">Invoice ${esc(invoice.number)}</h2>
    <p>Hi ${esc(first)}, here's your invoice from Bargain Bay${due ? ` — due <b>${esc(due)}</b>` : ''}.</p>
    ${invoice.memo ? `<p style="color:#555">${esc(invoice.memo)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${invoiceRows(invoice.items)}
      <tr><td style="padding:6px 0;text-align:right">Subtotal</td><td style="padding:6px 0;text-align:right">${money(invoice.subtotal)}</td></tr>
      ${Number(invoice.hst) ? `<tr><td style="padding:6px 0;text-align:right">HST (13%)</td><td style="padding:6px 0;text-align:right">${money(invoice.hst)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(invoice.total)}</td></tr>
    </table>
    <div style="border:1px solid #e3c34d;background:#fffbe9;border-radius:8px;padding:12px 14px;margin:14px 0">
      <b>Pay by Interac e-Transfer</b><br/>
      Send <b>${money(invoice.total)}</b> to <b>${esc(ETRANSFER_EMAIL)}</b> (auto-deposit — no security question needed).
      Put invoice number <b>${esc(invoice.number)}</b> in the message so we can match your payment.
    </div>
    <p style="font-size:13px;color:#666">View this invoice any time: <a href="${SITE_URL}/invoice/${encodeURIComponent(invoice.number)}?email=${encodeURIComponent(invoice.email)}">${SITE_URL}/invoice/${esc(invoice.number)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your invoice number.</p>
  </div>`;
  const customer = await sendEmail({ to: invoice.email, subject: `Your Bargain Bay invoice ${invoice.number}`, html });
  // Copy the owner so there's a record in the shared inbox too.
  notifyOwner(`🧾 Invoice ${invoice.number} sent — ${money(invoice.total)} (${invoice.name || invoice.email})`, html)
    .catch((e) => console.error('owner invoice copy failed', e.message));
  return customer;
}

// ---- Order status-change email ------------------------------------------
// Sent to the customer when the owner advances an order (payment received,
// ready, out for delivery, delivered, cancelled). `order` is the snake_case DB
// row; `items` is [{ title, price }]. Best-effort — never throws.
export async function sendOrderStatusEmail(order, items) {
  const pickup = order.delivery_method !== 'delivery';
  const first = (order.name || '').split(' ')[0] || 'there';
  const track = `${SITE_URL}/order/${encodeURIComponent(order.order_number)}`;

  // Reusable blocks
  const guidelines = `<div style="border:1px solid #d9e2ef;background:#f4f7fc;border-radius:8px;padding:12px 14px;margin:14px 0">
    <b>Delivery day guidelines</b>
    <ul style="margin:8px 0 0;padding-left:18px;font-size:13.5px;color:#444;line-height:1.6">
      <li>Have someone 18+ available to receive and inspect the unit.</li>
      <li>Clear a path from the entrance to the install spot; measure doorways/stairs ahead of time.</li>
      <li>Disconnect/empty any old appliance beforehand (we don't haul away unless arranged).</li>
      <li>Secure pets, and please reserve a parking spot for our truck.</li>
      <li>You'll be asked to sign for delivery and we'll take a couple of photos for our records.</li>
    </ul></div>`;
  const reviewCta = REVIEW_URL
    ? `<p style="margin:14px 0"><a href="${REVIEW_URL}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Leave us a review →</a></p>`
    : `<p style="margin:14px 0">Loved your experience? <b>Please leave us a review</b> — just reply to this email and let us know how we did!</p>`;

  const copy = {
    confirmed: {
      subject: `Payment received — order ${order.order_number}`,
      heading: 'Your order has been paid',
      body: `Thanks, ${esc(first)} — payment for order <b>${esc(order.order_number)}</b> is in. You'll receive another email as soon as your order is ready for ${pickup ? 'pick up' : 'delivery'}.`
    },
    ready: {
      subject: pickup ? `Your order ${order.order_number} is ready for pick up` : `Your order ${order.order_number} is ready to be delivered`,
      heading: pickup ? 'Your order is ready for pick up' : 'Your order is ready to be delivered',
      body: pickup
        ? `Good news, ${esc(first)} — order <b>${esc(order.order_number)}</b> is ready to collect at ${esc(PICKUP_ADDRESS)}. <a href="${SITE_URL}/order/${encodeURIComponent(order.order_number)}">Book your pickup time here</a> (Mon–Fri, 10am–5pm). Bring photo ID and a vehicle suited to the appliance.`
        : `Good news, ${esc(first)} — order <b>${esc(order.order_number)}</b> is ready to be delivered. We'll schedule your delivery and email you the day it's on the way.`
    },
    out_for_delivery: {
      subject: pickup ? `Order ${order.order_number} — pickup scheduled` : `Your order ${order.order_number} is on the way!`,
      heading: pickup ? 'Pickup scheduled' : 'Your order is on the way!',
      body: pickup
        ? `Your pickup for order <b>${esc(order.order_number)}</b> is scheduled — see you soon!`
        : `Order <b>${esc(order.order_number)}</b> is out for delivery today. You can follow its status on the tracking page below.`,
      extra: pickup ? '' : guidelines
    },
    delivered: {
      subject: pickup ? `Order ${order.order_number} — picked up` : `Order Delivered! — ${order.order_number}`,
      heading: pickup ? 'Picked up — thank you!' : 'Order Delivered!',
      body: `Thank you for shopping with Bargain Bay! Order <b>${esc(order.order_number)}</b> is ${pickup ? 'all yours' : 'delivered'} and covered by our one-year warranty.`,
      extra: reviewCta
    },
    cancelled: {
      subject: `We're sorry — order ${order.order_number} was cancelled`,
      heading: 'Your order was cancelled',
      body: `We're sorry, ${esc(first)} — order <b>${esc(order.order_number)}</b> has been cancelled. If you've already sent payment, we'll refund it right away. If this is a surprise or you'd like help finding another unit, just reply to this email — we'd love to make it right.`
    }
  };
  const m = copy[order.status];
  if (!m) return { skipped: true };

  // No tracking link on a finished (delivered) or cancelled order. Delivered
  // orders point support at customer service; everything else at sales.
  const showTrack = order.status !== 'cancelled' && order.status !== 'delivered';
  const contactLine = order.status === 'delivered'
    ? `Any issues with your order? Email <a href="mailto:${esc(CUSTOMER_SERVICE_EMAIL)}">${esc(CUSTOMER_SERVICE_EMAIL)}</a>.`
    : `Questions? Email ${esc(SALES_EMAIL)} with your order number.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">${esc(m.heading)}</h2>
    <p>${m.body}</p>
    ${m.extra || ''}
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${itemRows(items)}
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(order.total)}</td></tr>
    </table>
    ${showTrack ? `<p style="font-size:13px;color:#666">Track this order any time: <a href="${track}">${track}</a></p>` : ''}
    <p style="font-size:13px;color:#666">${contactLine}</p>
  </div>`;
  try {
    return await sendEmail({ to: order.email, subject: m.subject, html });
  } catch (e) {
    console.error('sendOrderStatusEmail failed', e.message);
    return { ok: false };
  }
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
