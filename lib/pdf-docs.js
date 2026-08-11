// PDF renderings of the hosted invoice (/invoice/[number]) and order receipt
// (/order/[orderNumber]) — same data, same wording, laid out for paper. Served
// by the /pdf routes next to those pages; keep the copy in sync with the pages.
import { PdfDoc } from './pdf';
import { money, warrantyLabel, STATUS_LABELS,
         BUSINESS_NAME, BUSINESS_LEGAL, BUSINESS_ADDRESS, HST_NUMBER,
         SALES_EMAIL, SERVICE_EMAIL, ETRANSFER_EMAIL, PICKUP_ADDRESS,
         RETURN_POLICY_SUMMARY } from './constants';

const M = 48;               // page margin
const PW = 612;             // page width (US Letter)
const R = PW - M;           // right edge of content
const CW = PW - M * 2;      // content width
const BOTTOM = 792 - 56;    // page-break threshold

const INK = [0.15, 0.16, 0.17];
const MUTED = [0.44, 0.46, 0.48];
const LIGHT = [0.82, 0.83, 0.84];
const GREEN = [0.06, 0.43, 0.34];
const RED = [0.72, 0.2, 0.16];
const AMBER = [0.62, 0.42, 0.03];
const BOX = [0.955, 0.955, 0.945]; // soft panel background

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : null);

// Shared page state: cursor + page-break. `ensure(n)` guarantees n points of
// room before drawing, starting a fresh page (with top margin) when short.
function cursor(doc) {
  const st = { y: 64 };
  st.ensure = (need) => { if (st.y + need > BOTTOM) { doc.addPage(); st.y = 56; } };
  return st;
}

// Business letterhead + document tag (INVOICE / ORDER) and number.
function letterhead(doc, st, tag, number) {
  doc.text(M, st.y, BUSINESS_NAME.toUpperCase(), { size: 20, bold: true, color: INK });
  doc.text(R, st.y - 6, tag, { size: 13, bold: true, color: INK, align: 'right' });
  doc.text(R, st.y + 8, number, { size: 11, color: INK, align: 'right' });
  st.y += 14;
  doc.text(M, st.y, `${BUSINESS_LEGAL} · ${BUSINESS_ADDRESS}`, { size: 8.5, color: MUTED });
  st.y += 11;
  doc.text(M, st.y, `${SALES_EMAIL} · HST# ${HST_NUMBER}`, { size: 8.5, color: MUTED });
  st.y += 9;
  doc.line(M, st.y, R, st.y, { width: 1.5, color: INK });
  st.y += 20;
}

// One label/amount summary row (Subtotal / HST / Total …).
function sumRow(doc, st, label, amount, { bold = false, color = INK, rule = false } = {}) {
  if (rule) { doc.line(M + CW * 0.5, st.y - 9, R, st.y - 9, { width: 0.6, color: LIGHT }); }
  doc.text(R - 110, st.y, label, { size: bold ? 11 : 10, bold, color, align: 'right' });
  doc.text(R, st.y, amount, { size: bold ? 11 : 10, bold, color, align: 'right' });
  st.y += bold ? 17 : 15;
}

// Soft-background note box with wrapped text. lines: array of {text, bold?}.
function noteBox(doc, st, parts) {
  const size = 9.5, lh = 13, pad = 10;
  const wrapped = [];
  for (const p of parts) for (const l of doc.wrap(p.text, CW - pad * 2, size, p.bold)) wrapped.push({ text: l, bold: p.bold });
  const h = wrapped.length * lh + pad * 2 - 3;
  st.ensure(h + 10);
  doc.rect(M, st.y - 4, CW, h, BOX);
  let ty = st.y + pad;
  for (const l of wrapped) { doc.text(M + pad, ty, l.text, { size, bold: l.bold, color: INK }); ty += lh; }
  st.y += h + 14;
}

function sectionTitle(doc, st, title) {
  st.ensure(60);
  doc.text(M, st.y, title, { size: 12, bold: true, color: INK });
  st.y += 8;
  doc.line(M, st.y, R, st.y, { width: 0.6, color: LIGHT });
  st.y += 16;
}

function footer(doc, st, kind, number) {
  // One small line — let it borrow the bottom margin rather than orphaning
  // itself on a fresh page; only break if it would genuinely run off the paper.
  if (st.y + 12 > 780) { doc.addPage(); st.y = 56; }
  st.y += 4;
  doc.text(M, st.y, `Questions about this ${kind}? Email ${SALES_EMAIL} with ${kind} number ${number}.`, { size: 8.5, color: MUTED });
}

// ---------------------------------------------------------------------------

// invoice: the object from getInvoiceByNumber() (items, payments, amountPaid,
// balance included). Mirrors the status/refund presentation of /invoice/[number].
export function invoicePdf(invoice) {
  const doc = new PdfDoc();
  const st = cursor(doc);

  const open = invoice.status === 'open';
  const partial = invoice.status === 'partial';
  const paid = invoice.status === 'paid';
  const voided = invoice.status === 'void';
  const refunded = invoice.status === 'refunded';
  const delivery = invoice.delivery_method === 'delivery';
  const refundTotal = Number(invoice.refund_total) || 0;
  const partialRefund = paid && refundTotal > 0;
  const amountPaid = Number(invoice.amountPaid) || 0;
  const balance = Number(invoice.balance) || 0;
  const statusLabel = paid ? (partialRefund ? 'PAID · PARTIAL REFUND' : 'PAID')
    : refunded ? 'REFUNDED' : voided ? 'VOID' : partial ? 'PARTIALLY PAID' : 'OPEN';
  const statusColor = paid ? GREEN : (voided || refunded) ? RED : AMBER;

  letterhead(doc, st, 'INVOICE', invoice.number);

  doc.text(M, st.y, statusLabel, { size: 10, bold: true, color: statusColor });
  const issued = `Issued ${fmtDate(invoice.created_at)}${invoice.due_date && open ? ` · due ${fmtDate(invoice.due_date)}` : ''}`;
  doc.text(M + doc.textWidth(statusLabel, 10, true) + 12, st.y, issued, { size: 9.5, color: MUTED });
  st.y += 24;

  // Bill to / fulfilment columns.
  const col2 = M + CW / 2 + 10;
  doc.text(M, st.y, 'BILL TO', { size: 8, bold: true, color: MUTED });
  doc.text(col2, st.y, delivery ? 'SHIP TO (DELIVERY)' : 'FULFILMENT', { size: 8, bold: true, color: MUTED });
  st.y += 13;
  const left = [invoice.name, invoice.email, invoice.phone].filter(Boolean);
  const right = delivery
    ? [invoice.name, invoice.address, [invoice.city, invoice.postal].filter(Boolean).join(' ')].filter(Boolean)
    : ['Pickup by appointment', PICKUP_ADDRESS];
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    if (left[i]) doc.text(M, st.y, left[i], { size: 10, bold: i === 0 && !!invoice.name, color: INK });
    if (right[i]) doc.text(col2, st.y, right[i], { size: 10, bold: delivery && i === 0 && !!invoice.name, color: INK });
    st.y += 14;
  }
  st.y += 10;

  // Status note / payment instructions — the same messages the hosted page shows.
  if (paid) {
    noteBox(doc, st, [{ text: `Paid${invoice.paid_at ? ` on ${fmtDate(invoice.paid_at)}` : ''}${invoice.payment_method ? ` · ${invoice.payment_method}` : ''} — thank you!`, bold: true }]);
  }
  if (partialRefund) {
    noteBox(doc, st, [{ text: `${money(refundTotal)} of this invoice was refunded — the refunded item(s) are marked below. Questions? Email ${SALES_EMAIL}.` }]);
  }
  if (refunded) noteBox(doc, st, [{ text: `This invoice was refunded${invoice.refunded_at ? ` on ${fmtDate(invoice.refunded_at)}` : ''}. Questions? Email ${SALES_EMAIL}.` }]);
  if (voided) noteBox(doc, st, [{ text: `This invoice was voided. Questions? Email ${SALES_EMAIL}.` }]);
  if (open || partial) {
    noteBox(doc, st, [
      { text: 'Pay by Interac e-Transfer.', bold: true },
      ...(partial ? [{ text: `We've received ${money(amountPaid)} so far — thank you!` }] : []),
      { text: `Send ${money(partial ? balance : invoice.total)} to ${ETRANSFER_EMAIL} (auto-deposit — no security question). Put invoice number ${invoice.number} in the message so we can match it. Prefer to pay in person? Reply to your invoice email and we'll arrange it.` }
    ]);
  }

  // Items.
  sectionTitle(doc, st, 'Items');
  for (const it of invoice.items) {
    const w = warrantyLabel(it.warranty_months);
    const lineRefunded = !!it.refunded_at && (partialRefund || refunded);
    const desc = it.description + (it.sku ? ` (${it.sku})` : '') + (lineRefunded ? ' — REFUNDED' : '');
    const lines = doc.wrap(desc, CW - 100, 10);
    const color = lineRefunded ? MUTED : INK;
    st.ensure(lines.length * 14 + (w && !lineRefunded ? 13 : 0) + 8);
    lines.forEach((l, i) => {
      doc.text(M, st.y, l, { size: 10, color });
      if (i === 0) doc.text(R, st.y, money(it.amount), { size: 10, color, align: 'right' });
      if (lineRefunded) {
        doc.line(M, st.y - 3, M + doc.textWidth(l, 10), st.y - 3, { width: 0.6, color: MUTED });
        if (i === 0) doc.line(R - doc.textWidth(money(it.amount), 10), st.y - 3, R, st.y - 3, { width: 0.6, color: MUTED });
      }
      st.y += 14;
    });
    if (w && !lineRefunded) { doc.text(M + 10, st.y, `• ${w}`, { size: 9, color: GREEN }); st.y += 13; }
    st.y += 4;
  }

  st.ensure(120);
  st.y += 6;
  sumRow(doc, st, 'Subtotal', money(invoice.subtotal), { rule: true });
  if (Number(invoice.hst) > 0) sumRow(doc, st, 'HST (13%)', money(invoice.hst));
  sumRow(doc, st, 'Total', money(invoice.total), { bold: true });
  if (partial) {
    sumRow(doc, st, 'Paid so far', `-${money(amountPaid)}`);
    sumRow(doc, st, 'Balance owing', money(balance), { bold: true });
  }
  if (partialRefund) {
    sumRow(doc, st, 'Refunded', `-${money(refundTotal)}`);
    sumRow(doc, st, 'Net after refund', money(Math.max(0, Number(invoice.total) - refundTotal)), { bold: true });
  }

  if (invoice.memo) {
    st.ensure(40);
    for (const l of doc.wrap(invoice.memo, CW, 9.5)) { doc.text(M, st.y, l, { size: 9.5, color: MUTED }); st.y += 13; }
  }
  st.ensure(20);
  doc.text(M, st.y, `${BUSINESS_LEGAL} — GST/HST # ${HST_NUMBER}.`, { size: 8.5, color: MUTED });
  st.y += 22;

  // Returns & warranty summary (same short form as the hosted invoice).
  sectionTitle(doc, st, 'Returns & warranty');
  for (const p of RETURN_POLICY_SUMMARY) {
    const lines = doc.wrap(p, CW - 12, 8.5);
    st.ensure(lines.length * 11.5 + 4);
    lines.forEach((l, i) => {
      if (i === 0) doc.text(M, st.y, '•', { size: 8.5, color: MUTED });
      doc.text(M + 12, st.y, l, { size: 8.5, color: MUTED });
      st.y += 11.5;
    });
    st.y += 3;
  }
  st.ensure(26);
  st.y += 2;
  for (const l of doc.wrap(`Returns & warranty claims: ${SERVICE_EMAIL} (with your invoice number, model, issue & photos). Full policy: bargainbay.ca/policies/returns.`, CW, 8.5)) {
    doc.text(M, st.y, l, { size: 8.5, color: MUTED });
    st.y += 11.5;
  }
  st.y += 8;

  footer(doc, st, 'invoice', invoice.number);
  return doc.build();
}

// ---------------------------------------------------------------------------

// order: the object from getOrderByNumber() (items attached). A printable
// receipt version of /order/[orderNumber] — status, items, totals, fulfilment.
export function orderPdf(order) {
  const doc = new PdfDoc();
  const st = cursor(doc);

  const pickup = order.delivery_method !== 'delivery';
  const cancelled = order.status === 'cancelled';
  const refunded = order.status === 'refunded';
  const pendingPayment = order.status === 'pending_payment';
  const statusLabel = pendingPayment ? 'CONFIRMED · PAYMENT PENDING' : (STATUS_LABELS[order.status] || order.status).toUpperCase();
  const statusColor = (cancelled || refunded) ? RED : pendingPayment ? AMBER : GREEN;
  const fee = order.delivery_method === 'delivery'
    ? Math.max(0, Number(order.total) - Number(order.subtotal) - Number(order.hst)) : 0;

  letterhead(doc, st, 'ORDER', order.order_number);

  doc.text(M, st.y, statusLabel, { size: 10, bold: true, color: statusColor });
  doc.text(M + doc.textWidth(statusLabel, 10, true) + 12, st.y, `Placed ${fmtDate(order.created_at)}`, { size: 9.5, color: MUTED });
  st.y += 24;

  if (cancelled) noteBox(doc, st, [{ text: `This order was cancelled. Questions? Email ${SALES_EMAIL}.` }]);
  if (refunded) noteBox(doc, st, [{ text: `This order was refunded. Questions? Email ${SALES_EMAIL}.` }]);
  if (pendingPayment) {
    noteBox(doc, st, order.payment_method === 'in_person'
      ? [{ text: `Payment due ${pickup ? 'on pickup' : 'on delivery'}.`, bold: true },
         { text: `Pay ${money(order.total)} by cash, debit, or credit card in person ${pickup ? 'when you pick up' : 'when we deliver'}. We'll email ${order.email} to arrange a time.` }]
      : [{ text: 'Payment due — Interac e-Transfer.', bold: true },
         { text: `Send ${money(order.total)} to ${ETRANSFER_EMAIL} (auto-deposit — no security question). Put your order number ${order.order_number} in the message. Unpaid orders are cancelled automatically after 24 hours.` }]);
  }

  sectionTitle(doc, st, 'Items');
  for (const it of order.items) {
    const desc = it.title + (it.sku ? ` (${it.sku})` : '');
    const lines = doc.wrap(desc, CW - 100, 10);
    st.ensure(lines.length * 14 + 8);
    lines.forEach((l, i) => {
      doc.text(M, st.y, l, { size: 10, color: INK });
      if (i === 0) doc.text(R, st.y, money(it.price), { size: 10, color: INK, align: 'right' });
      st.y += 14;
    });
    st.y += 4;
  }

  st.ensure(100);
  st.y += 6;
  sumRow(doc, st, 'Subtotal', money(order.subtotal), { rule: true });
  sumRow(doc, st, pickup ? 'Warehouse pickup' : 'Local delivery', pickup ? 'Free' : money(fee));
  sumRow(doc, st, 'HST (13%)', money(order.hst));
  sumRow(doc, st, 'Total', money(order.total), { bold: true });

  st.ensure(20);
  doc.text(M, st.y, `${BUSINESS_LEGAL} — GST/HST # ${HST_NUMBER}. This document is your receipt; keep your order number for reference.`, { size: 8.5, color: MUTED });
  st.y += 24;

  sectionTitle(doc, st, pickup ? 'Pickup details' : 'Delivery details');
  const details = pickup
    ? [PICKUP_ADDRESS, `By appointment — we'll email ${order.email} to schedule. Bring photo ID and a vehicle suited to the appliance.`]
    : [`${order.address}, ${order.city}, ON ${order.postal}`, `We'll call ${order.phone || 'you'} to arrange a delivery window. Delivery is to your door / ground floor.`];
  doc.text(M, st.y, details[0], { size: 10, color: INK });
  st.y += 14;
  for (const l of doc.wrap(details[1], CW, 9)) { doc.text(M, st.y, l, { size: 9, color: MUTED }); st.y += 12.5; }
  st.y += 10;

  footer(doc, st, 'order', order.order_number);
  return doc.build();
}
