// Abandoned carts: tell staff, and (when switched on) remind the customer.
//
// TWO DIFFERENT THINGS, DELIBERATELY KEPT APART.
//
// 1. notifyStaffOfAbandonedCarts — an internal email to our own sales inbox.
//    Not a commercial message to anyone; no consent question. A digest, never
//    one email per cart.
//
// 2. sendCartReminders — a COMMERCIAL ELECTRONIC MESSAGE to a shopper at 4h, 24h
//    and 72h. CASL applies. Every recipient goes through filterAudience (which
//    FAILS CLOSED), every email carries the sender's identity, an unsubscribe
//    link and List-Unsubscribe / List-Unsubscribe-Post headers. Someone who only
//    typed an email at checkout and never bought has NO consent on record and
//    gets nothing. Do not "fix" that here — the fix is collecting a real
//    opt-in (see CLAUDE.md, "Abandoned-cart reminders"), not loosening this.
//    It is also OFF until ABANDONED_CART_EMAILS=on, pending the owner's choice
//    of how consent is collected.
//
// Outside production nothing real is sent and nothing is recorded (see
// lib/environment.js): a staging deploy sharing the database must not burn a
// customer's reminder steps.
import { hasDb, query } from './db';
import { abandonedCarts, DEFAULT_QUIET_HOURS } from './abandoned-carts';
import { sendEmail, esc } from './email';
import { filterAudience } from './consent';
import { unsubscribeUrl } from './campaigns';
import { SALES_EMAIL, BUSINESS_ADDRESS, money } from './constants';
import { SITE_URL } from './site';
import { isProduction } from './environment';

// Hours of silence after the cart's last activity.
export const STEP_HOURS = [4, 24, 72];
// A cron outage must not turn into a late blast: past the last step plus this
// grace the sequence is simply over.
export const GRACE_HOURS = 12;
// Customers are not emailed overnight (Toronto). Steps wait for the morning.
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 21;

export const remindersEnabled = () => process.env.ABANDONED_CART_EMAILS === 'on';
export const staffRecipient = () => process.env.ABANDONED_CART_NOTIFY_TO || SALES_EMAIL;

const torontoHour = () =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

const availableUnits = (c) => c.units.filter((u) => u.state === 'available');
const stillLive = (c) => c.ageHours <= STEP_HOURS[STEP_HOURS.length - 1] + GRACE_HOURS;

// ---- 1. staff ---------------------------------------------------------------

export async function notifyStaffOfAbandonedCarts({ send = sendEmail } = {}) {
  const out = { notified: 0, carts: 0 };
  if (!hasDb()) return out;
  const carts = (await abandonedCarts({ hours: DEFAULT_QUIET_HOURS, limit: 300 }))
    .filter((c) => !c.notifiedAt && c.availableCount > 0 && stillLive(c));
  if (!carts.length) return out;

  // Claim first, send second: two overlapping runs cannot both get the row.
  const { rows: claimed } = await query(
    `UPDATE cart_sessions SET notified_at = now()
      WHERE id = ANY($1) AND notified_at IS NULL RETURNING id`, [carts.map((c) => c.id)]);
  const mine = new Set(claimed.map((r) => r.id));
  const list = carts.filter((c) => mine.has(c.id));
  if (!list.length) return out;

  const release = () => query(`UPDATE cart_sessions SET notified_at = NULL WHERE id = ANY($1)`, [list.map((c) => c.id)]).catch(() => {});
  try {
    const rows = list.map((c) => {
      const who = [c.name, c.email, c.phone].filter(Boolean).map(esc).join(' · ');
      const units = availableUnits(c).map((u) => `${esc(u.title)} (${esc(u.sku)}) ${u.price == null ? '' : money(u.price)}`).join('<br/>');
      return `<tr><td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #eee">${who}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${units}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">${money(c.availableTotal)}</td></tr>`;
    }).join('');
    const res = await send({
      to: staffRecipient(),
      subject: `${list.length} abandoned cart${list.length === 1 ? '' : 's'} to follow up`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2e2d2b">
        <p>These shoppers left units in their cart. Each is also on the <b>My Day</b> list as an unassigned follow-up.</p>
        <table style="border-collapse:collapse;width:100%"><tr style="text-align:left;font-size:12px;color:#888"><th style="padding:6px 10px">Customer</th><th style="padding:6px 10px">Still for sale</th><th style="padding:6px 10px">Total</th></tr>${rows}</table>
        <p><a href="${esc(SITE_URL)}/admin/dashboard">Open the Sales dashboard</a></p></div>`
    });
    // Outside production the mail is redirected or refused: put the flag back
    // so production still tells staff about these carts.
    if (!res?.ok || !isProduction()) await release();
    if (res?.ok && isProduction()) { out.notified = 1; out.carts = list.length; }
  } catch (e) {
    console.error('abandoned cart digest failed (continuing):', e.message);
    await release();
  }
  return out;
}

// ---- 2. the customer sequence --------------------------------------------------

const COPY = [
  { subject: 'You left something in your cart', lead: 'You left this in your cart at Bargain Bay:' },
  { subject: 'Still thinking it over?', lead: 'Your cart at Bargain Bay is still waiting:' },
  { subject: 'Last reminder about your cart', lead: 'One last note about the cart you left at Bargain Bay:' }
];
const WHY = {
  express: 'You asked us to send you emails like this.',
  implied_purchase: 'You bought from us in the last two years.',
  implied_inquiry: 'You asked us for a quote in the last six months.'
};

export function reminderEmail({ cart, step, basis }) {
  const copy = COPY[step - 1];
  const units = availableUnits(cart);
  const url = unsubscribeUrl(cart.email);
  const rows = units.map((u) =>
    `<li style="margin:6px 0">${esc(u.title)}${u.price == null ? '' : ` — <b>${esc(money(u.price))}</b>`}</li>`).join('');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b;font-size:15px;line-height:1.6">
    <p>Hi ${esc(String(cart.name || '').trim().split(/\s+/)[0] || 'there')},</p>
    <p>${copy.lead}</p>
    <ul style="padding-left:18px">${rows}</ul>
    <p>Every unit we sell is one of a kind, so someone else may buy it before you do. We can't hold it for you until you check out.</p>
    <p><a href="${esc(SITE_URL)}/cart" style="display:inline-block;background:#e8541c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Go back to my cart</a></p>
    <hr style="border:none;border-top:1px solid #eee;margin:22px 0"/>
    <p style="font-size:12px;color:#888"><b>Bargain Bay</b> — liquidation appliances.<br/>${esc(BUSINESS_ADDRESS)}<br/>
    <a href="mailto:${esc(SALES_EMAIL)}">${esc(SALES_EMAIL)}</a><br/><br/>
    ${esc(WHY[basis] || 'You are on our mailing list.')} <a href="${esc(url)}" style="color:#666">Unsubscribe</a>.</p></div>`;
  return {
    subject: copy.subject, html,
    headers: {
      'List-Unsubscribe': `<${url}>, <mailto:${SALES_EMAIL}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };
}

/** The step due for a cart right now: the HIGHEST whose time has come. */
export function dueStep(ageHours) {
  if (!(ageHours <= STEP_HOURS[STEP_HOURS.length - 1] + GRACE_HOURS)) return 0;
  let due = 0;
  STEP_HOURS.forEach((h, i) => { if (ageHours >= h) due = i + 1; });
  return due;
}

export async function sendCartReminders({ send = sendEmail, hour = torontoHour(), force = false } = {}) {
  const out = { sent: 0, failed: 0, skipped: 0, reason: null };
  if (!hasDb()) return out;
  if (!force && !remindersEnabled()) return { ...out, reason: 'off' };
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { ...out, reason: 'quiet hours' };

  const candidates = (await abandonedCarts({ hours: STEP_HOURS[0], limit: 300 }))
    .filter((c) => c.email && c.availableCount > 0 && dueStep(c.ageHours) > 0);
  if (!candidates.length) return out;

  // CASL gate. Fails closed: an unreadable consent table sends nothing.
  const gate = await filterAudience(candidates.map((c) => ({ ...c })), 'email');
  if (gate.failed) return { ...out, reason: 'consent unreadable' };
  out.skipped += gate.blocked.length;

  const doneEmails = new Set();
  for (const c of gate.allowed) {
    try {
      const key = c.email.toLowerCase();
      if (doneEmails.has(key)) { out.skipped++; continue; }     // one email per person per pass
      const step = dueStep(c.ageHours);
      // Steps overtaken by a later one (cron was down) are recorded, not sent late.
      for (let s = 1; s < step; s++) {
        await query(
          `INSERT INTO abandoned_cart_emails (cart_id, generation, step, email, status, detail)
           VALUES ($1,$2,$3,$4,'skipped','overtaken') ON CONFLICT DO NOTHING`, [c.id, c.generation, s, key]);
      }
      // The claim. Losing the race (or a step already sent) returns no row.
      const { rows } = await query(
        `INSERT INTO abandoned_cart_emails (cart_id, generation, step, email, basis)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING step`, [c.id, c.generation, step, key, c.consentBasis]);
      if (!rows.length) continue;
      doneEmails.add(key);

      const mail = reminderEmail({ cart: c, step, basis: c.consentBasis });
      const res = await send({ to: c.email, ...mail });
      if (!isProduction() || res?.skipped) {
        // Nothing real went out: give the step back for production.
        await query(`DELETE FROM abandoned_cart_emails WHERE cart_id=$1 AND generation=$2 AND step=$3`, [c.id, c.generation, step]);
        out.skipped++;
      } else if (res?.ok) {
        await query(`UPDATE abandoned_cart_emails SET status='sent', sent_at=now() WHERE cart_id=$1 AND generation=$2 AND step=$3`, [c.id, c.generation, step]);
        out.sent++;
      } else {
        // Not retried: a timeout can mean Resend accepted it, and "at most once"
        // beats "eventually".
        await query(`UPDATE abandoned_cart_emails SET status='failed', detail=$4 WHERE cart_id=$1 AND generation=$2 AND step=$3`,
          [c.id, c.generation, step, String(res?.error || 'send failed').slice(0, 300)]);
        out.failed++;
      }
    } catch (e) {
      console.error('abandoned cart reminder failed (continuing):', e.message);
      out.failed++;
    }
  }
  return out;
}
