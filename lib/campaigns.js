// Email (Resend) + SMS (Twilio) campaigns to audience segments from the
// customer database. Sends synchronously in the request — fine for SMB-sized
// lists (dozens–hundreds); a background queue would be the next step at scale.
import { query, hasDb } from './db';
import { marketingAudience } from './customers';
import { sendEmail, esc } from './email';
import { sendSms, marketingFrom, smsMarketingConfigured } from './sms';
import { SALES_EMAIL, BUSINESS_ADDRESS } from './constants';
import { filterAudience, withdrawConsent, BASIS_LABEL } from './consent';
import { unsubToken } from './links';
import { SITE_URL } from './site';

const SALE = "('confirmed','ready','out_for_delivery','delivered')";

// segment: 'all' | 'buyers' | 'members'
//
// Reads the CUSTOMER database, not `users`. It used to read `users`, so it could
// only reach people who had created an account — every guest checkout, invoiced
// client, phone lead and walk-in was invisible to marketing while
// backfillCustomers was busy assembling exactly those people into a table
// nothing marketed to.
//
// The query lives in lib/customers because ORDER_MATCH does: "has this person
// bought from us" has to be the same question the customer list asks, or a
// segment disagrees with the rollup on the screen beside it.
export const audience = (segment) => marketingAudience(segment);

export async function audienceCounts(segment) {
  const list = await audience(segment);
  return {
    total: list.length,
    emailable: list.filter((r) => r.email).length,
    smsable: list.filter((r) => r.phone).length
  };
}

// Campaign send log — feeds the Marketing dashboard. Self-provisioning.
let logEnsured = null;
async function ensureCampaignLog() {
  if (!hasDb()) return;
  if (logEnsured) return logEnsured;
  logEnsured = query(`CREATE TABLE IF NOT EXISTS campaign_log (
    id serial PRIMARY KEY, channel text, segment text, subject text,
    recipients int, sent int, failed int, created_at timestamptz DEFAULT now()
  )`).catch((e) => { logEnsured = null; throw e; });
  return logEnsured;
}
// One row per campaign key + address: lets a cut-short campaign be resumed without double-sending.
let recEnsured = null;
async function ensureRecipients() {
  if (!hasDb()) return;
  if (recEnsured) return recEnsured;
  recEnsured = query(`CREATE TABLE IF NOT EXISTS campaign_recipients (
    campaign_key text NOT NULL, email text NOT NULL, status text NOT NULL, error text,
    at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (campaign_key, email)
  )`).catch((e) => { recEnsured = null; throw e; });
  return recEnsured;
}
async function logRecipient(key, email, status, error) {
  try {
    await ensureRecipients();
    await query(`INSERT INTO campaign_recipients (campaign_key, email, status, error) VALUES ($1,$2,$3,$4)
      ON CONFLICT (campaign_key, email) DO UPDATE SET status = EXCLUDED.status, error = EXCLUDED.error, at = now()`,
      [key, String(email).toLowerCase(), status, error || null]);
  } catch (e) { console.error('campaign recipient log failed', e.message); }
}
export async function campaignRecipients(key) {
  await ensureRecipients();
  const { rows } = await query('SELECT email, status, error, at FROM campaign_recipients WHERE campaign_key = $1 ORDER BY at', [key]);
  return rows;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resend allows 10 requests a second; stay well under it.
const EMAIL_GAP_MS = 150;

async function logCampaign({ channel, segment, subject, recipients, sent, failed }) {
  try {
    await ensureCampaignLog();
    await query('INSERT INTO campaign_log (channel, segment, subject, recipients, sent, failed) VALUES ($1,$2,$3,$4,$5,$6)',
      [channel, segment || null, subject || null, recipients, sent, failed]);
  } catch (e) { console.error('campaign log failed', e.message); }
}

const firstName = (n) => (String(n || '').trim().split(/\s+/)[0] || 'there');
const personalize = (t, r) => String(t || '').replace(/\{\{\s*name\s*\}\}/gi, firstName(r.name));

// CASL wants every commercial message to identify the sender and carry an
// unsubscribe mechanism that WORKS. The old footer said to reply "UNSUBSCRIBE",
// which nothing read, and the privacy policy promised a link that was not here.
// This is that link.
export function unsubscribeUrl(identity, channel = 'email') {
  const id = String(identity || '').trim().toLowerCase();
  const qs = new URLSearchParams({ i: id, t: unsubToken(id) });
  if (channel === 'sms') qs.set('c', 'sms');
  return `${SITE_URL}/unsubscribe?${qs}`;
}

// Why they are getting it, in their own case — a stated basis is far more
// convincing than a generic line, and it is the same fact the audit trail holds.
const WHY = {
  express: 'You asked us to send you these.',
  implied_purchase: 'You bought from us in the last two years.',
  implied_inquiry: 'You asked us for a quote in the last six months.'
};

// `html`, when given, is the designed body (staff-authored, never from a customer) and replaces the
// escaped plain text. The footer (address, why they got it, unsubscribe) is ALWAYS added here.
function emailHtml(message, r, html) {
  const body = html ? personalize(html, r) : esc(personalize(message, r)).replace(/\n/g, '<br/>');
  const url = unsubscribeUrl(r.email);
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b;font-size:15px;line-height:1.6">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0"/>
    <p style="font-size:12px;color:#888">
    <b>Bargain Bay</b> — liquidation appliances.<br/>
    ${esc(BUSINESS_ADDRESS)}<br/>
    <a href="mailto:${esc(SALES_EMAIL)}">${esc(SALES_EMAIL)}</a><br/><br/>
    ${esc(WHY[r.consentBasis] || 'You are on our mailing list.')}
    <a href="${esc(url)}" style="color:#666">Unsubscribe from promotional emails</a>.</p>
  </div>`;
}

export async function sendEmailCampaign({ recipients, subject, message, html, segment, test = false, skip = [], campaignKey = '' }) {
  // A test send goes to whoever is composing it and is not a campaign, so it
  // does not consult the consent list — otherwise the owner cannot preview a
  // message to himself without first opting himself in.
  // `skip` = addresses that already received this campaign (resuming a cut-short send).
  const skipSet = new Set((skip || []).map((e) => String(e).trim().toLowerCase()));
  const todo = skipSet.size ? recipients.filter((r) => !skipSet.has(String(r.email || '').trim().toLowerCase())) : recipients;
  const key = campaignKey || `${new Date().toISOString().slice(0, 10)}:${subject}`;
  const gate = test
    ? { allowed: todo.map((r) => ({ ...r, consentBasis: 'implied_purchase' })), blocked: [], failed: false, counts: null }
    : await filterAudience(todo, 'email');

  if (gate.failed) return { channel: 'email', total: recipients.length, sent: 0, failed: 0, skipped: 0, blocked: gate.counts, consentError: gate.reason };

  let sent = 0, failed = 0;
  const failedEmails = [];
  for (const r of gate.allowed) {
    if (!test) await sleep(EMAIL_GAP_MS);
    const res = await sendEmail({
      to: r.email,
      subject: personalize(subject, r),
      html: emailHtml(message, r, html),
      // RFC 2369 + RFC 8058. This is what puts the native "Unsubscribe" button
      // next to the sender name in Gmail and Outlook — by a distance the most
      // used opt-out there is, and the one that keeps people from reaching for
      // the spam button instead, which is what actually damages the domain.
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(r.email)}>, <mailto:${SALES_EMAIL}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    });
    if (res && res.ok) sent++; else { failed++; failedEmails.push(r.email); }
    if (!test) await logRecipient(key, r.email, res && res.ok ? 'sent' : 'failed', res && !res.ok ? (res.reason || res.error || 'send failed') : null);
  }
  await logCampaign({ channel: 'email', segment, subject, recipients: gate.allowed.length, sent, failed });
  return {
    channel: 'email', total: recipients.length, sent, failed, failedEmails, campaignKey: key, alreadySent: recipients.length - todo.length,
    skipped: gate.counts ? gate.counts.noValue : 0,
    blocked: gate.counts
  };
}

export async function sendSmsCampaign({ recipients, message, segment, test = false }) {
  const gate = test
    ? { allowed: recipients, blocked: [], failed: false, counts: null }
    : await filterAudience(recipients, 'sms');

  if (gate.failed) return { channel: 'sms', total: recipients.length, sent: 0, failed: 0, skipped: 0, blocked: gate.counts, consentError: gate.reason };

  // ALWAYS from the marketing number, explicitly. An omitted `from` defaults to
  // the OPERATIONS number in lib/sms, and an advert on the number drivers sign
  // in with is the whole bug this separation exists to prevent.
  const from = marketingFrom();
  const usedOpsNumber = !smsMarketingConfigured();

  let sent = 0, failed = 0, optedOut = 0;
  for (const r of gate.allowed) {
    // "Reply STOP" is now true — /api/sms/inbound reads the replies.
    const res = await sendSms({ to: r.phone, body: personalize(message, r) + ' Reply STOP to opt out.', from });
    if (res && res.ok) { sent++; continue; }
    failed++;
    // Twilio blocked it because this person texted STOP to this number at some
    // point. We have no consent record for them, so record one now — otherwise
    // every future campaign re-attempts a send Twilio will never deliver, and
    // the opt-out lives only in Twilio's console where nobody looks.
    if (res && res.optedOut) {
      optedOut++;
      withdrawConsent({
        channel: 'sms', phone: r.phone, source: 'bounce',
        evidence: 'Twilio reported this number as opted out (error 21610) on a campaign send'
      }).catch(() => {});
    }
  }
  await logCampaign({ channel: 'sms', segment, subject: 'SMS', recipients: gate.allowed.length, sent, failed });
  return {
    channel: 'sms', total: recipients.length, sent, failed, optedOut,
    skipped: gate.counts ? gate.counts.noValue : 0,
    blocked: gate.counts,
    usedOpsNumber
  };
}

// For the composer: how many of a segment may actually be messaged, and why the
// rest may not. The owner has to be able to see that a list of 400 is a
// sendable list of 180 BEFORE writing the message, not after.
export async function consentCounts(segment, channel) {
  const list = await audience(segment);
  const gate = await filterAudience(list, channel);
  return { ...gate.counts, failed: gate.failed, labels: BASIS_LABEL };
}
