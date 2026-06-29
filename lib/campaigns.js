// Email (Resend) + SMS (Twilio) campaigns to audience segments from the
// customer database. Sends synchronously in the request — fine for SMB-sized
// lists (dozens–hundreds); a background queue would be the next step at scale.
import { query, hasDb } from './db';
import { sendEmail, esc } from './email';
import { sendSms } from './sms';
import { SALES_EMAIL } from './constants';

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

function emailHtml(message, r) {
  const body = esc(personalize(message, r)).replace(/\n/g, '<br/>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b;font-size:15px;line-height:1.6">
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0"/>
    <p style="font-size:12px;color:#888">Bargain Bay — liquidation appliances, Hamilton &amp; the GTA.<br/>
    You're receiving this because you have an account with us or have purchased from us.
    To stop receiving these, reply "UNSUBSCRIBE" or email <a href="mailto:${esc(SALES_EMAIL)}">${esc(SALES_EMAIL)}</a>.</p>
  </div>`;
}

export async function sendEmailCampaign({ recipients, subject, message, segment }) {
  let sent = 0, failed = 0, skipped = 0;
  for (const r of recipients) {
    if (!r.email) { skipped++; continue; }
    const res = await sendEmail({ to: r.email, subject: personalize(subject, r), html: emailHtml(message, r) });
    if (res && res.ok) sent++; else failed++;
  }
  await logCampaign({ channel: 'email', segment, subject, recipients: recipients.length, sent, failed });
  return { channel: 'email', total: recipients.length, sent, failed, skipped };
}

export async function sendSmsCampaign({ recipients, message, segment }) {
  let sent = 0, failed = 0, skipped = 0;
  for (const r of recipients) {
    if (!r.phone) { skipped++; continue; }
    const res = await sendSms({ to: r.phone, body: personalize(message, r) + ' Reply STOP to opt out.' });
    if (res && res.ok) sent++; else failed++;
  }
  await logCampaign({ channel: 'sms', segment, subject: 'SMS', recipients: recipients.length, sent, failed });
  return { channel: 'sms', total: recipients.length, sent, failed, skipped };
}
