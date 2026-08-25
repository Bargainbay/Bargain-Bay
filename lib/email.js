// Transactional email via Resend. Degrades to a logged no-op when
// RESEND_API_KEY is unset, so the site (and signups) work with or without it.
import { money, PICKUP_ADDRESS, SALES_EMAIL, CUSTOMER_SERVICE_EMAIL, ETRANSFER_EMAIL, REVIEW_URL, warrantyLabel,
         BUSINESS_NAME, BUSINESS_LEGAL, BUSINESS_ADDRESS, HST_NUMBER, DISPATCH_EMAIL, SERVICE_EMAIL, RETURN_POLICY_SUMMARY } from './constants';
import { SITE_URL } from './site';
import { linkToken } from './links';
import { brandFor, DEFAULT_BRAND } from './brands';

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

const FROM = (brand) => brandFor(brand).from();
const NOTIFY = () => process.env.NOTIFY_EMAIL || 'bargain.bay.save@gmail.com';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// brand decides who the mail is FROM and who a reply goes to. Defaults to
// Bargain Bay so every existing caller keeps behaving exactly as it did.
export async function sendEmail({ to, subject, html, brand = DEFAULT_BRAND }) {
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
      body: JSON.stringify({
        from: FROM(brand), to: [to || NOTIFY()],
        // Reply goes to the brand's own monitored inbox — an RS Solutions client
        // replying must not land in the Bargain Bay storefront queue.
        reply_to: brandFor(brand).contactEmail,
        subject, html
      })
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

// Forgot-password reset link. The link is valid for 1 hour and dies on use.
export async function sendPasswordResetEmail({ to, name, url }) {
  const first = (name || '').split(' ')[0] || 'there';
  return sendEmail({
    to,
    subject: 'Reset your Bargain Bay password',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
      <h2 style="text-transform:uppercase;letter-spacing:.05em">Password reset</h2>
      <p>Hi ${esc(first)} — someone (hopefully you) asked to reset the password for this email on bargainbay.ca.</p>
      <p style="margin:22px 0"><a href="${url}" style="background:#2e2d2b;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:700">Choose a new password</a></p>
      <p style="font-size:13px;color:#666">The link works for 1 hour and can only be used once. If you didn't ask for this, you can ignore it — your password stays as it is.</p>
    </div>`
  });
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
    <p style="font-size:13px;color:#666">Track this order any time: <a href="${SITE_URL}/order/${encodeURIComponent(order.orderNumber)}?t=${linkToken('order', order.orderNumber)}">${SITE_URL}/order/${esc(order.orderNumber)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your order number.</p>
  </div>`;
}

// ---- Invoice email -------------------------------------------------------
// Itemized invoice with Interac e-transfer instructions. `invoice` carries:
// number, name, email, subtotal, hst, total, memo, dueDate, items[{description, amount}].
function invoiceRows(items) {
  return (items || [])
    .map((it) => {
      const w = warrantyLabel(it.warrantyMonths ?? it.warranty_months);
      return `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.description)}${w ? `<br/><span style="font-size:12px;color:#0f6e56">✓ ${esc(w)}</span>` : ''}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:top">${money(it.amount)}</td>
    </tr>`;
    })
    .join('');
}

// Business letterhead + "Bill To" / "Ship To" blocks shared by the invoice
// email and (via the hosted page) the on-screen invoice.
function billToBlock(invoice) {
  const delivery = invoice.deliveryMethod === 'delivery';
  const shipLines = delivery
    ? [invoice.address, [invoice.city, invoice.postal].filter(Boolean).join(' ')].filter(Boolean)
    : [];
  return `<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13.5px">
    <tr>
      <td style="vertical-align:top;width:50%;padding-right:12px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:3px">Bill to</div>
        ${invoice.name ? `<div style="font-weight:bold">${esc(invoice.name)}</div>` : ''}
        <div>${esc(invoice.email)}</div>
        ${invoice.phone ? `<div>${esc(invoice.phone)}</div>` : ''}
      </td>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:3px">${delivery ? 'Ship to (delivery)' : 'Fulfilment'}</div>
        ${delivery
          ? (invoice.name ? `<div style="font-weight:bold">${esc(invoice.name)}</div>` : '') + shipLines.map((l) => `<div>${esc(l)}</div>`).join('')
          : `<div>Pickup by appointment</div><div style="color:#666">${esc(PICKUP_ADDRESS)}</div>`}
      </td>
    </tr>
  </table>`;
}

function returnPolicyBlock() {
  return `<div style="border-top:1px solid #eee;margin-top:18px;padding-top:12px;font-size:12px;color:#666;line-height:1.5">
    <div style="font-weight:bold;color:#444;margin-bottom:6px">Returns &amp; warranty (summary)</div>
    <ul style="margin:0;padding-left:18px">
      ${RETURN_POLICY_SUMMARY.map((p) => `<li style="margin-bottom:4px">${esc(p)}</li>`).join('')}
    </ul>
    <div style="margin-top:8px">Returns &amp; warranty claims: ${esc(SERVICE_EMAIL)} (with your invoice number, model, issue &amp; photos). Full policy: <a href="${SITE_URL}/policies/returns" style="color:#666">${SITE_URL}/policies/returns</a></div>
  </div>`;
}

export async function sendInvoiceEmail(invoice) {
  const B = brandFor(invoice.brand);
  const due = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const first = (invoice.name || '').split(' ')[0] || 'there';
  // A re-sent partially-paid invoice shows the payments to date and asks only
  // for the balance; a fresh invoice has no payments and asks for the total.
  const paid = Number(invoice.amountPaid) || 0;
  const owing = paid > 0 ? (Number(invoice.balance) || Math.max(0, Number(invoice.total) - paid)) : Number(invoice.total);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#2e2d2b">
    <table style="width:100%;border-collapse:collapse;border-bottom:2px solid #2e2d2b;padding-bottom:8px">
      <tr>
        <td style="vertical-align:top">
          <div style="font-size:20px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em">${esc(B.name)}</div>
          <div style="font-size:12px;color:#666">${esc(B.legal)} · ${esc(B.address)}</div>
          <div style="font-size:12px;color:#666">${esc(B.contactEmail)} · HST# ${esc(B.hst)}</div>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap">
          <div style="font-size:16px;font-weight:bold">INVOICE</div>
          <div style="font-size:13px">${esc(invoice.number)}</div>
          ${due ? `<div style="font-size:12px;color:#666">Due ${esc(due)}</div>` : ''}
        </td>
      </tr>
    </table>
    <p style="margin-top:14px">Hi ${esc(first)}, here's your invoice from ${esc(B.name)}${due ? ` — due <b>${esc(due)}</b>` : ''}.</p>
    ${billToBlock(invoice)}
    ${invoice.memo ? `<p style="color:#555">${esc(invoice.memo)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${invoiceRows(invoice.items)}
      <tr><td style="padding:6px 0;text-align:right">Subtotal</td><td style="padding:6px 0;text-align:right">${money(invoice.subtotal)}</td></tr>
      ${Number(invoice.hst) ? `<tr><td style="padding:6px 0;text-align:right">HST (13%)</td><td style="padding:6px 0;text-align:right">${money(invoice.hst)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Total</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(invoice.total)}</td></tr>
      ${paid > 0 ? `<tr><td style="padding:6px 0;text-align:right;color:#0f6e56">Paid so far</td><td style="padding:6px 0;text-align:right;color:#0f6e56">−${money(paid)}</td></tr>
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Balance owing</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(owing)}</td></tr>` : ''}
    </table>
    <div style="border:1px solid #e3c34d;background:#fffbe9;border-radius:8px;padding:12px 14px;margin:14px 0">
      <b>Pay by Interac e-Transfer</b><br/>
      Send <b>${money(owing)}</b> to <b>${esc(ETRANSFER_EMAIL)}</b> (auto-deposit — no security question needed).
      Put invoice number <b>${esc(invoice.number)}</b> in the message so we can match your payment.
    </div>
    <p style="font-size:13px;color:#666">View this invoice any time: <a href="${B.url()}/invoice/${encodeURIComponent(invoice.number)}?t=${linkToken('invoice', invoice.number)}">${B.url()}/invoice/${esc(invoice.number)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your invoice number.</p>
    ${returnPolicyBlock()}
  </div>`;
  const customer = await sendEmail({
    to: invoice.email, brand: B.key,
    subject: `Your ${B.name} invoice ${invoice.number}`, html
  });
  // Copy the owner so there's a record in the shared inbox too. Awaited: on
  // Vercel an un-awaited send freezes with the function and fires on the NEXT
  // invocation (or never) — the exact bug that delayed invoice emails.
  await notifyOwner(`🧾 Invoice ${invoice.number} sent — ${money(invoice.total)} (${invoice.name || invoice.email})`, html)
    .catch((e) => console.error('owner invoice copy failed', e.message));
  return customer;
}

// Sent when an invoice is marked PAID: a receipt, not a payment request.
// The customer's next step is simply to wait — we email again (via the order
// status flow) when the unit is ready for pick up / delivery.
export async function sendInvoicePaidEmail(invoice) {
  const B = brandFor(invoice.brand);
  const first = (invoice.name || '').split(' ')[0] || 'there';
  const pickup = invoice.deliveryMethod !== 'delivery';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">Payment received</h2>
    <p>Thanks, ${esc(first)} — we've received your payment for invoice <b>${esc(invoice.number)}</b>.
       You'll receive another email as soon as your order is ready for ${pickup ? 'pick up' : 'delivery'} —
       nothing more to do right now.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${invoiceRows(invoice.items)}
      ${Number(invoice.hst) ? `<tr><td style="padding:6px 0;text-align:right">HST (13%)</td><td style="padding:6px 0;text-align:right">${money(invoice.hst)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">Total paid</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(invoice.total)}</td></tr>
    </table>
    <p style="font-size:13px;color:#666">View this invoice any time: <a href="${B.url()}/invoice/${encodeURIComponent(invoice.number)}?t=${linkToken('invoice', invoice.number)}">${B.url()}/invoice/${esc(invoice.number)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your invoice number.</p>
    ${returnPolicyBlock()}
  </div>`;
  const customer = await sendEmail({
    to: invoice.email, brand: B.key,
    subject: `Payment received — invoice ${invoice.number}`, html
  });
  await notifyOwner(`💰 Invoice ${invoice.number} paid — ${money(invoice.total)} (${invoice.name || invoice.email})`, html)
    .catch((e) => console.error('owner paid copy failed', e.message));
  return customer;
}

// Receipt for a PARTIAL payment (deposit / instalment): confirms what was
// received and states the balance still owing, with e-transfer instructions.
export async function sendInvoicePartialPaymentEmail({ number, email, name, amount, method, amountPaid, balance, total, brand }) {
  const B = brandFor(brand);
  const first = (name || '').split(' ')[0] || 'there';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">Payment received — balance owing</h2>
    <p>Thanks, ${esc(first)} — we've received your payment of <b>${money(amount)}</b> (${esc(method)}) toward invoice <b>${esc(number)}</b>.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:6px 0">Invoice total</td><td style="padding:6px 0;text-align:right">${money(total)}</td></tr>
      <tr><td style="padding:6px 0">Paid so far</td><td style="padding:6px 0;text-align:right">${money(amountPaid)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #ddd">Balance owing</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #ddd">${money(balance)}</td></tr>
    </table>
    <p>You can pay the balance by Interac e-transfer to <b>${esc(ETRANSFER_EMAIL)}</b> (auto-deposit — put ${esc(number)} in the message) or in person.</p>
    <p style="font-size:13px;color:#666">View this invoice any time: <a href="${B.url()}/invoice/${encodeURIComponent(number)}?t=${linkToken('invoice', number)}">${B.url()}/invoice/${esc(number)}</a></p>
    <p style="font-size:13px;color:#666">Questions? Email ${esc(SALES_EMAIL)} with your invoice number.</p>
  </div>`;
  const customer = await sendEmail({
    to: email, brand: B.key,
    subject: `Payment received — ${money(amount)} toward invoice ${number} (${money(balance)} owing)`, html
  });
  await notifyOwner(`💵 Partial payment on ${number} — ${money(amount)} received, ${money(balance)} still owing (${name || email})`, html)
    .catch((e) => console.error('owner partial copy failed', e.message));
  return customer;
}

// ---- Packing slip (warehouse / delivery team) ----------------------------
// Internal pick sheet — units with their 8-digit serials, condition, ship-to.
// NO prices (it's for picking/prepping, not billing). `slip` is the getPackingSlip
// row (snake_case) with items[{ description, sku, kind, serial, condition }].
export function packingSlipRows(items) {
  return (items || [])
    .map((it, i) => {
      const service = (it.kind === 'service');
      const serial = service ? '—' : (it.serial || '(no serial on file)');
      const sub = [it.sku, it.condition].filter(Boolean).join(' · ');
      return `<tr>
      <td style="padding:7px 4px;border-bottom:1px solid #eee;text-align:center;color:#999">${i + 1}</td>
      <td style="padding:7px 4px;border-bottom:1px solid #eee">${esc(it.description)}${sub ? `<br/><span style="font-size:11px;color:#888">${esc(sub)}</span>` : ''}</td>
      <td style="padding:7px 4px;border-bottom:1px solid #eee;font-family:monospace;font-weight:bold;font-size:14px;white-space:nowrap">${esc(serial)}</td>
      <td style="padding:7px 4px;border-bottom:1px solid #eee;text-align:center">☐</td>
    </tr>`;
    })
    .join('');
}

export function packingSlipHtml(slip) {
  const delivery = slip.delivery_method === 'delivery';
  const ship = delivery
    ? [slip.name, slip.address, [slip.city, slip.postal].filter(Boolean).join(' '), slip.phone].filter(Boolean)
    : [slip.name, 'Pickup by appointment', PICKUP_ADDRESS, slip.phone].filter(Boolean);
  const unitCount = (slip.items || []).filter((it) => it.kind !== 'service').length;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#2e2d2b">
    <table style="width:100%;border-collapse:collapse;border-bottom:2px solid #2e2d2b;padding-bottom:8px">
      <tr>
        <td style="vertical-align:top">
          <div style="font-size:18px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em">${esc(BUSINESS_NAME)} — Packing Slip</div>
          <div style="font-size:12px;color:#666">For warehouse / delivery — pick by serial. Not a receipt.</div>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap">
          <div style="font-size:13px">Ref ${esc(slip.number || '')}</div>
          <div style="font-size:12px;color:#666">${esc(delivery ? 'DELIVERY' : 'PICKUP')}</div>
        </td>
      </tr>
    </table>
    <div style="margin:14px 0;font-size:13.5px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#999;margin-bottom:3px">${delivery ? 'Deliver to' : 'Pickup for'}</div>
      ${ship.map((l) => `<div>${esc(l)}</div>`).join('')}
    </div>
    <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13.5px">
      <tr style="font-size:11px;color:#888;text-transform:uppercase">
        <td style="padding:4px;text-align:center">#</td>
        <td style="padding:4px">Item</td>
        <td style="padding:4px">Serial</td>
        <td style="padding:4px;text-align:center">Picked</td>
      </tr>
      ${packingSlipRows(slip.items)}
    </table>
    <p style="font-size:12px;color:#666">${unitCount} unit${unitCount === 1 ? '' : 's'} to pick${slip.memo ? ` · Note: ${esc(slip.memo)}` : ''}</p>
    <div style="margin-top:18px;font-size:12px;color:#666">Prepared by ____________________  ·  Date __________  ·  Loaded ☐  ·  Verified against serials ☐</div>
  </div>`;
}

export async function sendPackingSlipEmail(slip, { to } = {}) {
  const html = packingSlipHtml(slip);
  const dest = to || DISPATCH_EMAIL;
  const tag = slip.delivery_method === 'delivery' ? 'Delivery' : 'Pickup';
  return sendEmail({ to: dest, subject: `📦 Packing slip ${slip.number || ''} — ${tag} (${slip.name || slip.email})`, html });
}

// ---- Quote email ---------------------------------------------------------
// Itemized, non-binding package quote. `quote` carries: number, name, email,
// items[{description, retail, amount}], retailSubtotal, subtotal, pct,
// bundlePrice, hst, bundleTotal, cash, total, freeDelivery, expiresAt, memo.
function quoteRows(items) {
  return (items || [])
    .map((it) => `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.description)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;color:#999;text-decoration:line-through">${it.retail ? money(it.retail) : ''}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(it.amount)}</td>
    </tr>`)
    .join('');
}

export async function sendQuoteEmail(quote) {
  const valid = quote.expiresAt ? new Date(quote.expiresAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const first = (quote.name || '').split(' ')[0] || 'there';
  const hostedUrl = `${SITE_URL}/quote/${encodeURIComponent(quote.number)}?t=${linkToken('quote', quote.number)}`;
  const discountRow = quote.pct > 0
    ? `<tr><td colspan="2" style="padding:6px 0;text-align:right">Bundle discount (${Number(quote.pct)}%)</td><td style="padding:6px 0;text-align:right">−${money(quote.subtotal - quote.bundlePrice)}</td></tr>`
    : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">Quote ${esc(quote.number)}</h2>
    <p>Hi ${esc(first)}, here's your package quote from Bargain Bay${valid ? ` — valid until <b>${esc(valid)}</b>` : ''}.</p>
    ${quote.memo ? `<p style="color:#555">${esc(quote.memo)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <tr><td style="font-size:12px;color:#888">Item</td><td style="font-size:12px;color:#888;text-align:right">Retail</td><td style="font-size:12px;color:#888;text-align:right">Our price</td></tr>
      ${quoteRows(quote.items)}
      <tr><td colspan="2" style="padding:8px 0 0;text-align:right">Subtotal (our price)</td><td style="padding:8px 0 0;text-align:right">${money(quote.subtotal)}</td></tr>
      ${discountRow}
      <tr><td colspan="2" style="padding:6px 0;text-align:right">Bundle price</td><td style="padding:6px 0;text-align:right">${money(quote.bundlePrice)}</td></tr>
      ${Number(quote.hst) ? `<tr><td colspan="2" style="padding:6px 0;text-align:right">HST (13%)</td><td style="padding:6px 0;text-align:right">${money(quote.hst)}</td></tr>` : ''}
      <tr><td colspan="2" style="padding:6px 0;text-align:right;font-weight:bold">${quote.cash != null ? 'Bundle total' : 'Total'}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(quote.bundleTotal)}</td></tr>
      ${quote.cash != null ? `<tr><td colspan="2" style="padding:6px 0;text-align:right;font-weight:bold;color:#0f6e56">Cash deal (all-in)</td><td style="padding:6px 0;text-align:right;font-weight:bold;color:#0f6e56">${money(quote.cash)}</td></tr>` : ''}
    </table>
    ${quote.freeDelivery ? `<p style="margin:6px 0;color:#0f6e56"><b>✓ Free local delivery included.</b></p>` : ''}
    <div style="border:1px solid #d9e2ef;background:#f4f7fc;border-radius:8px;padding:12px 14px;margin:14px 0;font-size:13.5px">
      This is a quote, not an order — nothing is reserved yet. Units are first-come, first-served, so reply or get in touch to lock yours in.
    </div>
    <p style="font-size:13px;color:#666">View this quote any time: <a href="${hostedUrl}">${SITE_URL}/quote/${esc(quote.number)}</a></p>
    <p style="font-size:13px;color:#666">Ready to go ahead, or want to tweak it? Just reply, or email ${esc(SALES_EMAIL)}.</p>
  </div>`;
  const customer = await sendEmail({ to: quote.email, subject: `Your Bargain Bay quote ${quote.number}`, html });
  // Copy the owner so there's a record in the shared inbox too.
  notifyOwner(`📋 Quote ${quote.number} sent — ${money(quote.total)} (${quote.name || quote.email})`, html)
    .catch((e) => console.error('owner quote copy failed', e.message));
  return customer;
}

// Instant acknowledgement to a customer who assembled a bundle on /bundle. The
// real priced quote follows once the owner prices & sends it — this just closes
// the loop so the customer isn't left wondering. `quote` carries: number, name,
// email, items[{description, amount}], total (list price, pre-discount).
export async function sendBundleRequestAck(quote) {
  const first = (quote.name || '').split(' ')[0] || 'there';
  const rows = (quote.items || [])
    .map((it) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.description)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(it.amount)}</td></tr>`)
    .join('');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">
    <h2 style="text-transform:uppercase;letter-spacing:.05em">We got your bundle request</h2>
    <p>Thanks, ${esc(first)} — we've received your bundle and we'll email your custom package quote shortly (usually the same day). Your reference is <b>${esc(quote.number)}</b>.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}
      <tr><td style="padding:6px 0;text-align:right;font-weight:bold">List total</td><td style="padding:6px 0;text-align:right;font-weight:bold">${money(quote.total)}</td></tr>
    </table>
    <p style="font-size:13px;color:#666">That's the list price — your <b>bundle discount</b> comes with the quote. Nothing is reserved yet. Questions, or want to tweak it? Just reply, or email ${esc(SALES_EMAIL)}.</p>
  </div>`;
  return sendEmail({ to: quote.email, subject: `We got your Bargain Bay bundle request ${quote.number}`, html });
}

// ---- Order status-change email ------------------------------------------
// Sent to the customer when the owner advances an order (payment received,
// ready, out for delivery, delivered, cancelled). `order` is the snake_case DB
// row; `items` is [{ title, price }]. Best-effort — never throws.
export async function sendOrderStatusEmail(order, items) {
  const pickup = order.delivery_method !== 'delivery';
  const first = (order.name || '').split(' ')[0] || 'there';
  const track = `${SITE_URL}/order/${encodeURIComponent(order.order_number)}?t=${linkToken('order', order.order_number)}`;
  const rate = `${SITE_URL}/rate/${encodeURIComponent(order.order_number)}?t=${linkToken('order', order.order_number)}`;

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
  // 1-tap satisfaction rating (feeds the Customer dashboard CSAT).
  const ratingCta = `<p style="margin:14px 0">How did we do? <a href="${rate}" style="text-decoration:underline">Rate your experience ★</a></p>`;

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
        ? `Good news, ${esc(first)} — order <b>${esc(order.order_number)}</b> is ready to collect at ${esc(PICKUP_ADDRESS)}. <a href="${track}">Book your pickup time here</a> (open 7 days, 10am–8pm). Bring photo ID and a vehicle suited to the appliance.`
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
      extra: ratingCta + reviewCta
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
