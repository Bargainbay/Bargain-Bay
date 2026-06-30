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
    const att = em.attachments[0];
    try {
      const { base64 } = await getAttachment(inbox, em.id, att.attachmentId);
      const ex = await extractPurchaseInvoice({ base64, mediaType: att.mimeType });
      if (!ex.items.length) {
        // Record it so we don't re-read a non-invoice PDF every run.
        await enqueue({ source: 'email', emailMsgId: em.id, sender: em.from, subject: em.subject, items: [], status: 'rejected', note: 'no appliance line items found' });
        continue;
      }
      await enqueue({ source: 'email', emailMsgId: em.id, vendor: ex.vendor, invoice: ex.invoiceNumber, sender: em.from, subject: em.subject, items: ex.items });
      queued++; units += ex.items.length;
      await notify(`📦 New purchase invoice read: ${ex.items.length} unit(s)${ex.vendor ? ` from ${ex.vendor}` : ''}${ex.invoiceNumber ? ` (inv ${ex.invoiceNumber})` : ''}. Review & add to the tracker in Operations → "Items waiting to be added".`);
    } catch (e) {
      console.error('intake-watch extract failed for', em.id, e.message);
    }
  }
  return { ok: true, queued, units, skipped, scanned: emails.length };
}
