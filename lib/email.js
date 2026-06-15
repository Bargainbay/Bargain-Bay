// Transactional email via Resend. Degrades to a logged no-op when
// RESEND_API_KEY is unset, so the site (and signups) work with or without it.
export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

const FROM = () => process.env.RESEND_FROM || 'Bargain Bay <onboarding@resend.dev>';
const NOTIFY = () => process.env.NOTIFY_EMAIL || 'service@rssolutions.ca';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEmail({ to, subject, html }) {
  if (!emailConfigured()) {
    console.log('[email skipped — RESEND_API_KEY not set]', subject);
    return { skipped: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to || NOTIFY()], subject, html })
    });
    if (!r.ok) {
      console.error('resend send failed', r.status, await r.text().catch(() => ''));
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('resend error', e.message);
    return { ok: false };
  }
}

// Notify the store owner. Fire-and-forget at call sites (don't block the response).
export async function notifyOwner(subject, html) {
  return sendEmail({ to: NOTIFY(), subject, html });
}
