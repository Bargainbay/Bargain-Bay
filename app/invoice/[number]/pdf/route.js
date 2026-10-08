import PDFDocument from 'pdfkit';
import { hasDb } from '../../../../lib/db';
import { getInvoiceByNumber } from '../../../../lib/invoices';
import { getSession, isStaff } from '../../../../lib/auth';
import { verifyLinkToken } from '../../../../lib/links';
import { brandFor } from '../../../../lib/brands';
import { warrantyLabel, PICKUP_ADDRESS, RETURN_POLICY_SUMMARY, ETRANSFER_EMAIL } from '../../../../lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Plain text, not lib/constants `money`: this is a printed document and must not
// depend on the server's ICU locale data.
const cad = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + s;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' }) : '');

function render(invoice, B) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Invoice ${invoice.number}`, Author: B.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 50, R = 562, W = R - L;
    const grey = '#666666', ink = '#222222';
    const status = invoice.status;
    const paid = status === 'paid', partial = status === 'partial', open = status === 'open';
    const refundTotal = Number(invoice.refund_total) || 0;
    const partialRefund = paid && refundTotal > 0;
    const amountPaid = Number(invoice.amountPaid) || 0;
    const balance = Number(invoice.balance) || 0;
    const statusLabel = paid ? (partialRefund ? 'PAID - PARTIAL REFUND' : 'PAID') : status === 'refunded' ? 'REFUNDED' : status === 'void' ? 'VOID' : partial ? 'PARTIALLY PAID' : 'OPEN';

    // Letterhead
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text(String(B.name).toUpperCase(), L, 50);
    doc.font('Helvetica').fontSize(9).fillColor(grey)
      .text(`${B.legal} - ${B.address}`, L, 76, { width: 340 })
      .text(`${B.contactEmail} - HST# ${B.hst}`, L, doc.y);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text('INVOICE', 380, 50, { width: R - 380, align: 'right' });
    doc.font('Helvetica').fontSize(11).text(invoice.number, 380, 70, { width: R - 380, align: 'right' });
    doc.fontSize(9).fillColor(grey).text(statusLabel, 380, 86, { width: R - 380, align: 'right' });
    const hy = Math.max(doc.y, 100) + 6;
    doc.moveTo(L, hy).lineTo(R, hy).lineWidth(1.5).strokeColor(ink).stroke();

    // Dates
    let y = hy + 10;
    doc.font('Helvetica').fontSize(10).fillColor(grey)
      .text(`Issued ${fmtDate(invoice.created_at)}${invoice.due_date && open ? `   -   Due ${fmtDate(invoice.due_date)}` : ''}`, L, y);
    y = doc.y + 12;

    // Bill to / Ship to
    const delivery = invoice.delivery_method === 'delivery';
    const label = (t, x, yy) => doc.font('Helvetica-Bold').fontSize(8).fillColor(grey).text(t, x, yy);
    label('BILL TO', L, y);
    label(delivery ? 'SHIP TO (DELIVERY)' : 'FULFILMENT', 320, y);
    const by = y + 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink);
    let leftY = by;
    doc.text(invoice.name || '', L, by, { width: 240 });
    doc.font('Helvetica').text(invoice.email || '', L, doc.y, { width: 240 });
    if (invoice.phone) doc.text(invoice.phone, L, doc.y, { width: 240 });
    leftY = doc.y;
    if (delivery) {
      doc.font('Helvetica-Bold').text(invoice.name || '', 320, by, { width: 242 });
      doc.font('Helvetica');
      if (invoice.address) doc.text(invoice.address, 320, doc.y, { width: 242 });
      const cp = [invoice.city, invoice.postal].filter(Boolean).join(' ');
      if (cp) doc.text(cp, 320, doc.y, { width: 242 });
    } else {
      doc.font('Helvetica').text('Pickup by appointment', 320, by, { width: 242 });
      doc.fillColor(grey).text(PICKUP_ADDRESS, 320, doc.y, { width: 242 });
    }
    y = Math.max(leftY, doc.y) + 18;

    // Items
    const amtX = R - 90;
    const ensure = (h) => { if (doc.y + h > 720) { doc.addPage(); doc.y = 50; } };
    doc.font('Helvetica-Bold').fontSize(8).fillColor(grey).text('DESCRIPTION', L, y).text('AMOUNT', amtX, y, { width: 90, align: 'right' });
    y += 13;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#bbbbbb').stroke();
    doc.y = y + 6;
    for (const it of invoice.items) {
      ensure(40);
      const refunded = !!it.refunded_at && (partialRefund || status === 'refunded');
      const rowY = doc.y;
      let desc = it.description || '';
      if (it.sku) desc += ` (${it.sku})`;
      doc.font('Helvetica').fontSize(10).fillColor(refunded ? grey : ink)
        .text(desc + (refunded ? '  [REFUNDED]' : ''), L, rowY, { width: amtX - L - 10, strike: refunded });
      const w = warrantyLabel(it.warranty_months);
      if (w && !refunded) doc.fontSize(9).fillColor('#0f6e56').text(w, L, doc.y, { width: amtX - L - 10 });
      if (it.kind === 'trade_in') doc.fontSize(9).fillColor(grey).text('Trade-in - we collect this unit from you.', L, doc.y, { width: amtX - L - 10 });
      const endY = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor(refunded ? grey : ink).text(cad(it.amount), amtX, rowY, { width: 90, align: 'right', strike: refunded });
      doc.y = endY + 6;
    }

    // Totals
    ensure(120);
    doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(0.5).strokeColor('#bbbbbb').stroke();
    doc.y += 8;
    const row = (k, v, bold) => {
      const yy = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(ink)
        .text(k, 330, yy, { width: 130 }).text(v, amtX, yy, { width: 90, align: 'right' });
      doc.y = yy + (bold ? 18 : 15);
    };
    row('Subtotal', cad(invoice.subtotal));
    if (Number(invoice.hst) > 0) row('HST (13%)', cad(invoice.hst));
    row('Total', cad(invoice.total), true);
    if (partial) { row('Paid so far', '-' + cad(amountPaid)); row('Balance owing', cad(balance), true); }
    if (partialRefund) { row('Refunded', '-' + cad(refundTotal)); row('Net after refund', cad(Math.max(0, Number(invoice.total) - refundTotal)), true); }

    if (paid) {
      doc.moveDown(0.5).font('Helvetica').fontSize(10).fillColor(ink)
        .text(`Paid${invoice.paid_at ? ` on ${fmtDate(invoice.paid_at)}` : ''}${invoice.payment_method ? ` - ${invoice.payment_method}` : ''}. Thank you!`, L, doc.y, { width: W });
    }
    if (open || partial) {
      ensure(70);
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Pay by Interac e-Transfer', L, doc.y, { width: W });
      doc.font('Helvetica').fontSize(9.5).fillColor(ink).text(
        `Send ${cad(partial ? balance : invoice.total)} to ${ETRANSFER_EMAIL} (auto-deposit, no security question). Put invoice number ${invoice.number} in the message so we can match it.`,
        L, doc.y, { width: W });
    }
    if (invoice.memo) {
      ensure(40);
      doc.moveDown(0.6).font('Helvetica').fontSize(9.5).fillColor(grey).text(String(invoice.memo), L, doc.y, { width: W });
    }
    doc.moveDown(0.6).fontSize(8.5).fillColor(grey).text(`${B.legal} - GST/HST # ${B.hst}.`, L, doc.y, { width: W });

    // Returns & warranty
    ensure(150);
    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Returns & warranty', L, doc.y);
    doc.moveDown(0.3).font('Helvetica').fontSize(8.5).fillColor(grey);
    for (const p of RETURN_POLICY_SUMMARY) {
      ensure(30);
      doc.text('- ' + p, L, doc.y, { width: W }).moveDown(0.25);
    }
    doc.text(`Questions about this invoice? ${B.contactEmail} (include your invoice number).`, L, doc.y + 4, { width: W });
    doc.end();
  });
}

export async function GET(req, { params }) {
  const { number } = await params;
  if (!hasDb()) return new Response('Not available', { status: 503 });
  const invoice = await getInvoiceByNumber(number).catch(() => null);
  if (!invoice) return new Response('Not found', { status: 404 });

  // Same access rule as the hosted page: staff, the owner of the invoice, the
  // signed ?t= link, or the matching ?email=.
  const url = new URL(req.url);
  const session = await getSession();
  const guestEmail = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const ok =
    (session && isStaff(session)) ||
    (session && session.email?.toLowerCase() === invoice.email?.toLowerCase()) ||
    verifyLinkToken('invoice', invoice.number, url.searchParams.get('t')) ||
    (guestEmail && guestEmail === invoice.email?.toLowerCase());
  if (!ok) return new Response('Not authorized', { status: 403 });

  const pdf = await render(invoice, brandFor(invoice.brand));
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${String(invoice.number).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
