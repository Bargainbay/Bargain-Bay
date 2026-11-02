// The two emails a seller gets when an application is decided.
//
// TRANSACTIONAL: they answer an application the person made. No unsubscribe header, and they
// must not become marketing (CASL: lib/consent.js).
//
// Awaited by the caller and never allowed to throw: a mail hiccup must not undo a decision that
// is already saved (a serverless instance is frozen once the response goes).
import { query } from './db';
import { sendEmail, esc } from './email';
import { SITE_URL } from './site';

const wrap = (inner) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">${inner}</div>`;
const button = (href, label) => `<p style="margin:22px 0"><a href="${href}" style="background:#2e2d2b;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:700">${esc(label)}</a></p>`;
const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

export function approvalEmail({ contactName, contactEmail, accessGranted = false }) {
  return {
    to: contactEmail,
    subject: 'You’re approved to sell on Bargain Bay',
    html: wrap(`
      <h2 style="text-transform:uppercase;letter-spacing:.05em">Welcome, ${esc(first(contactName))}</h2>
      <p>Your application to sell on Bargain Bay is approved.</p>
      <p><b>Your next steps</b></p>
      <ol style="padding-left:18px;font-size:14px;line-height:1.6">
        <li>Sign in at <a href="${SITE_URL}/login">${esc(SITE_URL)}/login</a> with <b>this email address</b> (create a free account at <a href="${SITE_URL}/signup">/signup</a> first if you have not). ${accessGranted ? 'Your seller access is already set up, so your seller dashboard opens at ' + esc(SITE_URL) + '/vendor.' : 'We are switching on your seller access now; your seller dashboard opens at ' + esc(SITE_URL) + '/vendor once that is done.'}</li>
        <li>Open Payouts in your dashboard and add how you want to be paid. We verify it before your first payment.</li>
        <li>Create your first listing with real photos and submit it. We review every listing before it goes live.</li>
      </ol>
      ${button(`${SITE_URL}/marketplace/guides/getting-started`, 'Read the getting-started guide')}
      <p style="font-size:13px;color:#666">Questions? Just reply to this email.</p>`)
  };
}

export function rejectionEmail({ contactName, contactEmail }) {
  return {
    to: contactEmail,
    subject: 'Your Bargain Bay seller application',
    html: wrap(`
      <p>Hi ${esc(first(contactName))},</p>
      <p>Thank you for applying to sell on Bargain Bay. We are not able to approve your application at this time.</p>
      <p>If you think we have got something wrong, or your details have changed, reply to this email and we will take another look.</p>`)
  };
}

/** Email the applicant their decision. Never throws; returns { ok } so the caller can tell staff. */
export async function notifyApplicantDecision(vendorId, approved, { accessGranted = false } = {}) {
  try {
    const { rows } = await query('SELECT contact_name, contact_email FROM vendors WHERE id = $1', [vendorId]);
    const v = rows[0];
    if (!v?.contact_email) return { ok: false, error: 'No contact email on the application.' };
    const msg = (approved ? approvalEmail : rejectionEmail)({ contactName: v.contact_name, contactEmail: v.contact_email, accessGranted });
    const r = await sendEmail(msg);
    if (r && r.ok === false && !r.skipped) console.error('seller decision email failed', r.error || r.reason);
    return { ok: !(r && r.ok === false), skipped: !!r?.skipped };
  } catch (e) {
    console.error('seller decision email failed', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}
