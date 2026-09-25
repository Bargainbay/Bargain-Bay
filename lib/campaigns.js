// Email (Resend) + SMS (Twilio) campaigns to audience segments from the
// customer database. Sends synchronously in the request — fine for SMB-sized
// lists (dozens–hundreds); a background queue would be the next step at scale.
import { query, hasDb } from './db';
import { sendEmail, esc } from './email';
import { sendSms } from './sms';
import { SALES_EMAIL, BUSINESS_ADDRESS } from './constants';
import { filterAudience, BASIS_LABEL } from './consent';
import { unsubToken } from './links';
import { SITE_URL } from './site';

const SALE = "('confirmed','ready','out_for_delivery','delivered')";

// segment: 'all' | 'buyers' | 'members'
export async function audience(segment) {
  if (!hasDb()) return [];
  let where = '';
  if (segment === 'members') where = `WHERE u.role = 'member' AND u.member_status = 'approved'`;
  else if (segment === 'buyers') where = `WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status IN ${SALE})`;
  const { rows } = await query(`SELECT id, name, email, phone FROM users u ${where} ORDER BY created_at DESC`);
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone }));
}

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

function emailHtml(message, r) {
  const body = esc(personalize(message, r)).replace(/\n/g, '<br/>');
  const url = unsubscribeUrl(r.email);
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b;font-size:15px;line-height:1.6">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0"/>
    <p style="font-size:12px;color:#888">
    <b>Bargain Bay</b> — liquidation appliances.<br/>
    ${esc(BUSINESS_ADDRESS)}<br/>
    <a href="mailto:${esc(SALES_EMAIL)}">${esc(SALES_EMAIL)}</a><br/><br/>
    ${esc(WHY[r.consentBasis] || 'You are on our mailing list.')}
    <a href="${esc(url)}" style="color:#666">Unsubscribe</a>.</p>
  </div>`;
}

export async function sendEmailCampaign({ recipients, subject, message, segment, test = false }) {
  // A test send goes to whoever is composing it and is not a campaign, so it
  // does not consult the consent list — otherwise the owner cannot preview a
  // message to himself without first opting himself in.
  const gate = test
    ? { allowed: recipients.map((r) => ({ ...r, consentBasis: 'express' })), blocked: [], failed: false, counts: null }
    : await filterAudience(recipients, 'email');

  if (gate.failed) return { channel: 'email', total: recipients.length, sent: 0, failed: 0, skipped: 0, blocked: gate.counts, consentError: gate.reason };

  let sent = 0, failed = 0;
  for (const r of gate.allowed) {
    const res = await sendEmail({
      to: r.email,
      subject: personalize(subject, r),
      html: emailHtml(message, r),
      // RFC 2369 + RFC 8058. This is what puts the native "Unsubscribe" button
      // next to the sender name in Gmail and Outlook — by a distance the most
      // used opt-out there is, and the one that keeps people from reaching for
      // the spam button instead, which is what actually damages the domain.
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(r.email)}>, <mailto:${SALES_EMAIL}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    });
    if (res && res.ok) sent++; else failed++;
  }
  await logCampaign({ channel: 'email', segment, subject, recipients: gate.allowed.length, sent, failed });
  return {
    channel: 'email', total: recipients.length, sent, failed,
    skipped: gate.counts ? gate.counts.noValue : 0,
    blocked: gate.counts
  };
}

export async function sendSmsCampaign({ recipients, message, segment, test = false }) {
  const gate = test
    ? { allowed: recipients, blocked: [], failed: false, counts: null }
    : await filterAudience(recipients, 'sms');

  if (gate.failed) return { channel: 'sms', total: recipients.length, sent: 0, failed: 0, skipped: 0, blocked: gate.counts, consentError: gate.reason };

  let sent = 0, failed = 0;
  for (const r of gate.allowed) {
    // "Reply STOP" is now true — /api/sms/inbound reads the replies.
    const res = await sendSms({ to: r.phone, body: personalize(message, r) + ' Reply STOP to opt out.' });
    if (res && res.ok) sent++; else failed++;
  }
  await logCampaign({ channel: 'sms', segment, subject: 'SMS', recipients: gate.allowed.length, sent, failed });
  return {
    channel: 'sms', total: recipients.length, sent, failed,
    skipped: gate.counts ? gate.counts.noValue : 0,
    blocked: gate.counts
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
