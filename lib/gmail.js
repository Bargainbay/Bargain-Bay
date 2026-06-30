// Gmail for Sarah — read + send, on the business inboxes. Reuses the existing
// Google service account (GOOGLE_CREDENTIALS). To act AS a mailbox the service
// account impersonates it (JWT `subject`), which the owner enables once via
// domain-wide delegation in the Google Workspace admin console (Gmail scopes).
//
// Env:
//   GOOGLE_CREDENTIALS      — service account JSON (already set for the sync)
//   SARAH_EMAIL_INBOXES     — comma list of mailboxes Sarah may use; first = default
//                             e.g. "customerservice@bargainbay.ca,sales@bargainbay.ca"
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // read + mark read
  'https://www.googleapis.com/auth/gmail.send'
];

function creds() {
  const raw = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return raw.trim().startsWith('{') ? JSON.parse(raw) : null; } catch { return null; }
}

export function inboxes() {
  return (process.env.SARAH_EMAIL_INBOXES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function gmailConfigured() {
  return !!creds() && inboxes().length > 0;
}

// Resolve the mailbox to act on. No inbox specified → the default (first one).
// A specific-but-unconfigured inbox throws a clear error instead of silently
// falling back to another mailbox — silently showing the wrong inbox's mail
// (e.g. asking for accounting@ and getting customerservice@) is misleading.
function resolveInbox(requested) {
  const list = inboxes();
  if (!list.length) throw new Error('No inboxes are connected yet (SARAH_EMAIL_INBOXES is empty).');
  const want = String(requested || '').trim().toLowerCase();
  if (!want) return list[0];
  if (list.includes(want)) return want;
  throw new Error(`"${requested}" isn't one of my connected inboxes. I currently have: ${list.join(', ')}.`);
}

async function gmailFor(mailbox) {
  const c = creds();
  if (!c) throw new Error('GOOGLE_CREDENTIALS not set');
  const auth = new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: SCOPES,
    subject: mailbox // impersonate the mailbox (needs domain-wide delegation)
  });
  return google.gmail({ version: 'v1', auth });
}

const headerMap = (msg) =>
  Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));

function decode(b64) {
  return Buffer.from(String(b64 || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  if (payload.parts) {
    for (const p of payload.parts) {
      const t = extractBody(p);
      if (t) return t;
    }
  }
  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) return decode(payload.body.data);
  return '';
}

// List recent messages (default: unread, last 14 days). Lightweight headers only.
export async function listRecent(inbox, { query, max = 10 } = {}) {
  const mailbox = resolveInbox(inbox);
  const gmail = await gmailFor(mailbox);
  const q = query || 'newer_than:14d -in:chats';
  const { data } = await gmail.users.messages.list({ userId: 'me', q, maxResults: Math.min(Math.max(max, 1), 25) });
  const out = [];
  for (const m of data.messages || []) {
    const { data: msg } = await gmail.users.messages.get({
      userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date']
    });
    const h = headerMap(msg);
    out.push({
      id: m.id, threadId: msg.threadId, from: h.from || '', subject: h.subject || '(no subject)',
      date: h.date || '', snippet: msg.snippet || '', unread: (msg.labelIds || []).includes('UNREAD')
    });
  }
  return { mailbox, count: out.length, emails: out };
}

// List recent emails that carry a PDF/image attachment (purchase invoices). Returns
// each with its attachment refs so the watcher can download + read them.
export async function listAttachmentEmails(inbox, { query, max = 15 } = {}) {
  const mailbox = resolveInbox(inbox);
  const gmail = await gmailFor(mailbox);
  const q = query || 'has:attachment (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg) newer_than:30d';
  const { data } = await gmail.users.messages.list({ userId: 'me', q, maxResults: Math.min(Math.max(max, 1), 25) });
  const out = [];
  for (const m of data.messages || []) {
    const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const h = headerMap(msg);
    const attachments = [];
    const walk = (p) => {
      if (!p) return;
      const mt = p.mimeType || '';
      if (p.filename && p.body?.attachmentId && (mt.includes('pdf') || mt.startsWith('image/'))) {
        attachments.push({ attachmentId: p.body.attachmentId, filename: p.filename, mimeType: mt });
      }
      (p.parts || []).forEach(walk);
    };
    walk(msg.payload);
    if (attachments.length) out.push({ id: m.id, from: h.from || '', subject: h.subject || '', date: h.date || '', attachments });
  }
  return { mailbox, emails: out };
}

// Download one attachment as standard base64 (for the Anthropic document API).
export async function getAttachment(inbox, messageId, attachmentId) {
  const mailbox = resolveInbox(inbox);
  const gmail = await gmailFor(mailbox);
  const { data } = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
  return { base64: String(data.data || '').replace(/-/g, '+').replace(/_/g, '/'), size: data.size };
}

export async function readEmail(inbox, id) {
  const mailbox = resolveInbox(inbox);
  const gmail = await gmailFor(mailbox);
  const { data: msg } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const h = headerMap(msg);
  return {
    mailbox, id, threadId: msg.threadId,
    from: h.from || '', to: h.to || '', subject: h.subject || '', date: h.date || '',
    messageId: h['message-id'] || '', references: h.references || '',
    body: (extractBody(msg.payload) || msg.snippet || '').slice(0, 8000)
  };
}

// Send an email (optionally as a reply within a thread). `to` may be the raw
// "Name <addr>" From of the email being answered.
export async function sendEmail(inbox, { to, subject, body, threadId, inReplyTo, references }) {
  const mailbox = resolveInbox(inbox);
  const gmail = await gmailFor(mailbox);
  const lines = [
    `From: ${mailbox}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"'
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references ? references + ' ' + inReplyTo : inReplyTo}`);
  }
  const raw = Buffer.from(lines.join('\r\n') + '\r\n\r\n' + String(body || ''))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } });
  return { ok: true, id: data.id, threadId: data.threadId, from: mailbox, to };
}
