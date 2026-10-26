// The three emails an affiliate programme sends. Plain data in, nothing imported from
// lib/affiliates (that module calls these), so there is no import cycle.
//
// These are TRANSACTIONAL: they answer something the person did (applied, was paid).
// They carry no unsubscribe header and must not become marketing - an affiliate is not
// on the marketing list by being one (CASL: lib/consent.js).
import { sendEmail, esc } from './email';
import { SITE_URL } from './site';
import { SERVICE_EMAIL } from './constants';

const money = (v) => `$${Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wrap = (inner) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">${inner}</div>`;
const button = (href, label) => `<p style="margin:22px 0"><a href="${href}" style="background:#2e2d2b;color:#fff;padding:12px 22px;text-decoration:none;border-radius:8px;font-weight:700">${esc(label)}</a></p>`;

// Awaited by callers and never allowed to throw: a mail hiccup must not undo an approval or a
// recorded payout. (A serverless instance is frozen once the response goes, so these are awaited.)
async function safely(fn, what) {
  try { const r = await fn(); if (r && r.ok === false && !r.skipped) console.error(`affiliate email failed (${what})`, r.error || r.reason); return r; }
  catch (e) { console.error(`affiliate email failed (${what})`, e?.message || e); return { ok: false, error: String(e?.message || e) }; }
}

export function sendApprovalEmail({ name, email, code, commissionPct, customerPct, holdDays }) {
  const link = `${SITE_URL}/?ref=${encodeURIComponent(code)}`;
  return safely(() => sendEmail({
    to: email,
    subject: 'You’re approved — your Bargain Bay affiliate code',
    html: wrap(`
      <h2 style="text-transform:uppercase;letter-spacing:.05em">You’re in, ${esc(String(name).split(/\s+/)[0])}</h2>
      <p>Your affiliate application is approved. Your code is <b style="font-size:18px">${esc(code)}</b>.</p>
      <p>Your link: <a href="${link}">${esc(link)}</a></p>
      <p>You earn <b>${esc(commissionPct)}%</b> of the goods (before tax and delivery) on every sale made with your code or link. Customers get ${esc(customerPct)}% off, so it’s an easy thing to share.</p>
      <ul style="padding-left:18px;font-size:14px">
        <li>You’re paid by e-transfer once the customer has the appliance and the ${esc(holdDays)}-day return window has closed.</li>
        <li>Say you earn a commission whenever you post, and please don’t send unsolicited texts or emails in our name.</li>
        <li>Orders placed with your own email aren’t commissionable.</li>
      </ul>
      ${button(`${SITE_URL}/affiliate`, 'Open my dashboard')}
      <p style="font-size:13px;color:#666">Every sale and its status shows in your dashboard as soon as it’s placed.</p>`)
  }), 'approval');
}

export function sendPayoutEmail({ name, email, amount, ref, balance }) {
  return safely(() => sendEmail({
    to: email,
    subject: `Your Bargain Bay commission: ${money(amount)} sent`,
    html: wrap(`
      <h2 style="text-transform:uppercase;letter-spacing:.05em">Commission sent</h2>
      <p>Hi ${esc(String(name).split(/\s+/)[0])} - we’ve e-transferred <b>${money(amount)}</b> to this address${ref ? ` (reference ${esc(ref)})` : ''}.</p>
      ${balance > 0.004 ? `<p>${money(balance)} more is already payable and will go in the next payment.</p>` : ''}
      ${button(`${SITE_URL}/affiliate`, 'See my earnings')}`)
  }), 'payout');
}

// To the office, when somebody applies: an application nobody sees is a person who waits for ever.
export function sendApplicationNotice({ name, email, audience }) {
  return safely(() => sendEmail({
    to: SERVICE_EMAIL,
    subject: `New affiliate application: ${name}`,
    html: wrap(`
      <p><b>${esc(name)}</b> (${esc(email)}) applied to be an affiliate.</p>
      <p style="font-size:14px">${esc(audience)}</p>
      ${button(`${SITE_URL}/admin/affiliates`, 'Review the application')}`)
  }), 'application notice');
}

// The weekly note to the office: who is owed and how much, ready to send from the bank.
export function sendPayoutRunNotice({ rows, total }) {
  const tr = rows.map((r) => `<tr><td style="padding:4px 10px 4px 0">${esc(r.name)}</td><td style="padding:4px 10px">${esc(r.payoutEmail)}</td><td style="padding:4px 0;text-align:right"><b>${money(r.amount)}</b></td></tr>`).join('');
  return safely(() => sendEmail({
    to: SERVICE_EMAIL,
    subject: `Affiliate payouts due: ${money(total)} to ${rows.length}`,
    html: wrap(`
      <h2>Affiliate commission is ready to pay</h2>
      <table style="font-size:14px;border-collapse:collapse">${tr}</table>
      <p style="font-size:14px">Send these e-transfers from the bank, then press <b>Record all as sent</b> on the Affiliates page. Nothing is paid automatically, and nothing is recorded until you do.</p>
      ${button(`${SITE_URL}/admin/affiliates`, 'Open the payout run')}`)
  }), 'payout run');
}
