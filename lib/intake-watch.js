// Email watcher: scans the intake inbox (accounting@) for vendor purchase invoices
// with PDF/image attachments, reads each with the AI extractor, and stages the
// units in the review queue (NOT straight to the tracker). Pings the owner on
// Telegram so they can review + approve. Idempotent via the email message id.
import { gmailConfigured, listAttachmentEmails, getAttachment } from './gmail';
import { extractPurchaseInvoice } from './purchase-intake';
import { alreadyQueued, enqueue } from './intake-queue';
import { sendMessage as tgSend } from './telegram';

const INTAKE_INBOX = () => process.env.INTAKE_INBOX || 'accounting@bargainbay.ca';

async function notify(text) {
  const target = process.env.SARAH_TELEGRAM_MGMT_GROUP ||
    (process.env.SARAH_TELEGRAM_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (!target || !process.env.TELEGRAM_BOT_TOKEN) return;
  try { await tgSend(target, text); } catch (e) { console.error('intake notify failed', e.message); }
}

export async function watchInvoiceInbox({ max = 15 } = {}) {
  if (!gmailConfigured()) return { ok: false, reason: 'gmail not configured' };
  const inbox = INTAKE_INBOX();

  let emails = [];
  try {
    ({ emails } = await listAttachmentEmails(inbox, { max }));
  } catch (e) {
    console.error('intake-watch list failed', e.message);
    return { ok: false, reason: e.message };
  }

  let queued = 0, units = 0, skipped = 0;
  for (const em of emails) {
    if (await alreadyQueued(em.id)) { skipped++; continue; }
    // Read EVERY attachment — vendors send multiple invoices per email, or a
    // packing slip first and the invoice second. The email is marked processed
    // by its message id, so anything skipped here would be lost forever.
    const items = [];
    let vendor = null, invoice = null, truncated = false, failed = 0;
    for (const att of em.attachments) {
      try {
        const { base64 } = await getAttachment(inbox, em.id, att.attachmentId);
        const ex = await extractPurchaseInvoice({ base64, mediaType: att.mimeType });
        if (ex.items.length) {
          items.push(...ex.items);
          vendor = vendor || ex.vendor;
          invoice = invoice || ex.invoiceNumber;
          truncated = truncated || !!ex.truncated;
        }
      } catch (e) {
        failed++;
        console.error('intake-watch extract failed for', em.id, att.filename || att.attachmentId, e.message);
      }
    }
    if (!items.length) {
      // If an attachment errored, leave the email unqueued so the next run
      // retries it; only mark it processed when it genuinely has no line items.
      if (!failed) await enqueue({ source: 'email', emailMsgId: em.id, sender: em.from, subject: em.subject, items: [], status: 'rejected', note: 'no product line items found' });
      continue;
    }
    const warn = truncated ? ' ⚠ One file was too long to read fully — only its first items were captured; check the list against the invoice.' : '';
    await enqueue({
      source: 'email', emailMsgId: em.id, vendor, invoice, sender: em.from, subject: em.subject, items,
      note: truncated ? 'truncated read — long invoice, verify items against the PDF' : null
    });
    queued++; units += items.length;
    await notify(`📦 New purchase invoice read: ${items.length} unit(s)${vendor ? ` from ${vendor}` : ''}${invoice ? ` (inv ${invoice})` : ''}. Review & add to the tracker in Operations → "Items waiting to be added".${warn}`);
  }
  return { ok: true, queued, units, skipped, scanned: emails.length };
}
